const { createClient } = require('@supabase/supabase-js');

const ROOTSYS_BASE_URL = (process.env.ROOTSYS_BASE_URL || 'https://rootsys.cloud/v1').replace(/\/$/,'');

function envModel(code){
  const key=`ROOTSYS_${String(code).toUpperCase()}_MODEL`;
  return process.env[key] || null;
}
function json(res,status,body){res.status(status).json(body);}
function cleanText(v,max=12000){return String(v||'').trim().slice(0,max);}
function extractJson(text){
  const raw=String(text||'').trim().replace(/^```json\s*/i,'').replace(/^```/,'').replace(/```$/,'').trim();
  try{return JSON.parse(raw);}catch{}
  const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(raw.slice(a,b+1));}catch{}}
  return null;
}
async function callRootsys({model,messages,temperature=0.3,max_tokens=1800}){
  if(!process.env.ROOTSYS_API_KEY) throw new Error('ROOTSYS_API_KEY belum ditetapkan di Vercel Environment Variables.');
  if(!model) throw new Error('Model AI belum ditetapkan untuk agent ini.');
  const r=await fetch(`${ROOTSYS_BASE_URL}/chat/completions`,{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.ROOTSYS_API_KEY}`},
    body:JSON.stringify({model,messages,temperature,max_tokens})
  });
  const text=await r.text();
  let data;try{data=JSON.parse(text);}catch{data=null;}
  if(!r.ok) throw new Error(`AI provider HTTP ${r.status}: ${data?.error?.message||text.slice(0,500)}`);
  const content=data?.choices?.[0]?.message?.content;
  if(!content) throw new Error('AI provider tidak memulangkan content yang sah.');
  return {content,usage:data?.usage||{},raw:data};
}
async function main(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed'});
  try{
    const authHeader=req.headers.authorization||'';
    const token=authHeader.startsWith('Bearer ')?authHeader.slice(7):'';
    if(!token) return json(res,401,{error:'Login diperlukan'});

    const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anon=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const secret=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
    if(!url||!anon||!secret) throw new Error('Supabase server environment belum lengkap.');

    const authClient=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
    const service=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error:userErr}=await authClient.auth.getUser(token);
    if(userErr||!user) return json(res,401,{error:'Session tidak sah'});
    const {data:profile}=await service.from('profiles').select('role,status').eq('id',user.id).single();
    if(!profile||profile.role!=='admin'||profile.status!=='active') return json(res,403,{error:'Admin sahaja'});

    const action=String(req.body?.action||'command');
    if(action==='test'){
      const code=String(req.body?.agent||'chief');
      const agent=await getAgent(service,code);
      const model=agent.model_name||envModel(code);
      const out=await callRootsys({model,messages:[{role:'system',content:'Reply exactly: WAHH AIR AI CONNECTION OK'},{role:'user',content:'Connection test'}],max_tokens:40,temperature:0});
      return json(res,200,{ok:true,provider:'rootsys',base_url:ROOTSYS_BASE_URL,model,response:out.content,usage:out.usage});
    }

    const instruction=cleanText(req.body?.instruction,8000);
    if(!instruction) return json(res,400,{error:'Arahan diperlukan'});
    const requested=String(req.body?.agent||'chief').toLowerCase();
    if(!['chief','marketing','accounting'].includes(requested)) return json(res,400,{error:'Agent tidak sah'});

    if(requested!=='chief'){
      const task=await createTask(service,user.id,requested,instruction,null,0);
      const result=await executeAgent({service,authClient,task,code:requested,instruction,userId:user.id});
      return json(res,200,{ok:true,task_id:task.id,agent:requested,...result});
    }

    const chiefTask=await createTask(service,user.id,'chief',instruction,null,0);
    await log(service,chiefTask.id,chiefTask.assigned_agent_id,user.id,'owner_instruction',{instruction});
    try{
      await service.from('ai_tasks').update({status:'working',started_at:new Date().toISOString()}).eq('id',chiefTask.id);
      await setAgentStatus(service,'chief','working');
      const chief=await getAgent(service,'chief');
      const model=chief.model_name||envModel('chief');
      const routeCall=await callRootsys({model,messages:[
        {role:'system',content:`You are CHIEF AI for WAHH AIR. Route owner instructions only. Return strict JSON only: {"route":"marketing|accounting|both|chief","reason":"short reason","marketing_task":"... or null","accounting_task":"... or null","chief_answer":"... or null"}. Do not invent business facts. Do not call unrelated staff. For marketing content use marketing. For financial numbers/accounting use accounting. For mixed requests use both. For simple management/general AI-office questions use chief.`},
        {role:'user',content:instruction}
      ],temperature:0.1,max_tokens:700});
      await recordUsage(service,chiefTask.id,chief.id,'rootsys',model,routeCall.usage);
      const route=extractJson(routeCall.content);
      if(!route||!['marketing','accounting','both','chief'].includes(route.route)) throw new Error('Chief AI memulangkan routing response yang tidak sah.');
      await log(service,chiefTask.id,chief.id,null,'chief_routed',route);

      if(route.route==='chief'){
        const answer=cleanText(route.chief_answer||route.reason,12000);
        await finishTask(service,chiefTask.id,answer,{route},false);
        await setAgentStatus(service,'chief','standby');
        return json(res,200,{ok:true,task_id:chiefTask.id,agent:'chief',route:'chief',result:answer});
      }

      const children=[];
      if(route.route==='marketing'||route.route==='both'){
        const childInstruction=cleanText(route.marketing_task||instruction,8000);
        const t=await createTask(service,user.id,'marketing',childInstruction,chiefTask.id,1);
        const r=await executeAgent({service,authClient,task:t,code:'marketing',instruction:childInstruction,userId:user.id});
        children.push({task_id:t.id,agent:'marketing',result:r.result,status:r.status});
      }
      if(route.route==='accounting'||route.route==='both'){
        const childInstruction=cleanText(route.accounting_task||instruction,8000);
        const t=await createTask(service,user.id,'accounting',childInstruction,chiefTask.id,1);
        const r=await executeAgent({service,authClient,task:t,code:'accounting',instruction:childInstruction,userId:user.id});
        children.push({task_id:t.id,agent:'accounting',result:r.result,status:r.status});
      }
      const summary=children.map(x=>`${x.agent.toUpperCase()}: ${x.result}`).join('\n\n');
      await finishTask(service,chiefTask.id,summary,{route,children:children.map(x=>({task_id:x.task_id,agent:x.agent,status:x.status}))},false);
      await setAgentStatus(service,'chief','standby');
      return json(res,200,{ok:true,task_id:chiefTask.id,agent:'chief',route:route.route,result:summary,children});
    }catch(e){
      await failTask(service,chiefTask.id,e.message);
      await setAgentStatus(service,'chief','failed');
      throw e;
    }
  }catch(e){
    console.error('AI Office error',e);
    return json(res,500,{error:e.message||'AI Office gagal memproses arahan'});
  }
}
async function getAgent(service,code){
  const {data,error}=await service.from('ai_agents').select('*').eq('code',code).single();
  if(error||!data) throw new Error(`AI agent ${code} belum disediakan. Jalankan migration 18.`);
  if(!data.enabled) throw new Error(`${data.display_name} sedang dimatikan.`);
  return data;
}
async function createTask(service,userId,code,instruction,parentId,depth){
  const agent=await getAgent(service,code);
  if(depth>Number(agent.max_delegation_depth||2)) throw new Error('Had delegation task telah dicapai.');
  const {data,error}=await service.from('ai_tasks').insert({created_by:userId,assigned_agent_id:agent.id,parent_task_id:parentId||null,original_instruction:instruction,task_description:instruction,status:'queued',approval_required:code==='marketing',approval_status:code==='marketing'?'pending':'not_required',delegation_depth:depth}).select('*').single();
  if(error) throw error;
  await log(service,data.id,agent.id,userId,'task_created',{agent:code,parent_task_id:parentId||null});
  return data;
}
async function executeAgent({service,authClient,task,code,instruction,userId}){
  const agent=await getAgent(service,code),model=agent.model_name||envModel(code);
  await service.from('ai_tasks').update({status:'working',started_at:new Date().toISOString()}).eq('id',task.id);
  await setAgentStatus(service,code,'working');
  await log(service,task.id,agent.id,null,'task_started',{agent:code});
  try{
    let system,context='';
    if(code==='marketing'){
      context=await marketingContext(service);
      system=`You are Marketing AI for WAHH AIR. Produce useful marketing work in Malay unless asked otherwise. You MUST use only business facts supplied in APPROVED BUSINESS CONTEXT for products, prices, contact details and promotions. Never invent missing prices/promotions/facts. If information is missing, say what is missing. Do not publish anything automatically. Output is a draft for owner approval.\n\nAPPROVED BUSINESS CONTEXT:\n${context}`;
    }else if(code==='accounting'){
      context=await accountingContext(authClient);
      system=`You are Accounting AI for WAHH AIR. You are READ-ONLY. Financial figures below were calculated by deterministic backend functions. Explain/analyse them; do not replace them with your own arithmetic or invent figures. Clearly distinguish billed amounts from payments where relevant.\n\nBACKEND FINANCIAL CONTEXT:\n${context}`;
    }else{
      system='You are Chief AI for WAHH AIR. Give concise management assistance. Do not invent business facts.';
    }
    const out=await callRootsys({model,messages:[{role:'system',content:system},{role:'user',content:instruction}],temperature:code==='marketing'?0.6:0.2,max_tokens:2200});
    await recordUsage(service,task.id,agent.id,'rootsys',model,out.usage);
    const needsApproval=code==='marketing';
    await service.from('ai_outputs').insert({task_id:task.id,output_type:'text',title:`${agent.display_name} Output`,content_text:out.content,content_json:{context_type:code}});
    await finishTask(service,task.id,out.content,{agent:code},needsApproval);
    await setAgentStatus(service,code,needsApproval?'waiting_approval':'standby');
    return {result:out.content,status:needsApproval?'waiting_approval':'completed',usage:out.usage};
  }catch(e){
    await failTask(service,task.id,e.message);
    await setAgentStatus(service,code,'failed');
    throw e;
  }
}
async function marketingContext(service){
  const [{data:flavours},{data:knowledge}]=await Promise.all([
    service.from('flavours').select('name,selling_price,active').eq('active',true).order('name'),
    service.from('business_knowledge').select('category,title,content').eq('approved',true).order('updated_at',{ascending:false}).limit(30)
  ]);
  return JSON.stringify({products:flavours||[],approved_knowledge:knowledge||[]},null,2).slice(0,18000);
}
async function accountingContext(authClient){
  const d=new Date(),start=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`,end=d.toISOString().slice(0,10);
  const [acct,business]=await Promise.all([
    authClient.rpc('admin_accounting_summary',{p_start:start,p_end:end}),
    authClient.rpc('admin_business_dashboard_summary')
  ]);
  if(acct.error) throw acct.error;
  return JSON.stringify({period:{start,end},accounting:acct.data?.[0]||{},business_dashboard:business.error?null:(business.data?.[0]||{})},null,2);
}
async function recordUsage(service,taskId,agentId,provider,model,usage){
  const input=Number(usage?.prompt_tokens??usage?.input_tokens??0),output=Number(usage?.completion_tokens??usage?.output_tokens??0),cached=Number(usage?.prompt_tokens_details?.cached_tokens??usage?.cached_tokens??0);
  const reportedCost=Number(usage?.cost??usage?.total_cost??0);
  await service.from('ai_usage').insert({task_id:taskId,agent_id:agentId,provider,model,input_tokens:input,output_tokens:output,cached_tokens:cached,estimated_cost:Number.isFinite(reportedCost)?reportedCost:0,cost_currency:'CNY'});
}
async function finishTask(service,id,result,resultJson,approval){
  const now=new Date().toISOString();
  await service.from('ai_tasks').update({result_summary:result,result_json:resultJson,status:approval?'waiting_approval':'completed',completed_at:approval?null:now,approval_status:approval?'pending':'not_required'}).eq('id',id);
  await log(service,id,null,null,approval?'waiting_approval':'task_completed',{});
}
async function failTask(service,id,message){
  await service.from('ai_tasks').update({status:'failed',error_message:cleanText(message,2000),completed_at:new Date().toISOString()}).eq('id',id);
  await log(service,id,null,null,'task_failed',{error:cleanText(message,1000)});
}
async function setAgentStatus(service,code,status){await service.from('ai_agents').update({status,updated_at:new Date().toISOString()}).eq('code',code);}
async function log(service,taskId,agentId,userId,action,details){await service.from('ai_activity_logs').insert({task_id:taskId||null,agent_id:agentId||null,actor_user_id:userId||null,action,details:details||{}});}

module.exports=main;
