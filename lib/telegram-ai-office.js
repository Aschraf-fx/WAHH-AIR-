const { esc, sendMessage } = require('./telegram-admin');

const ROOTSYS_BASE_URL=(process.env.ROOTSYS_BASE_URL||'https://rootsys.cloud/v1').replace(/\/$/,'');
const VALID_AGENTS=new Set(['chief','marketing','accounting','social_media']);

function clean(v,max=10000){return String(v||'').trim().slice(0,max);}
function modelEnv(code){return process.env[`ROOTSYS_${String(code).toUpperCase()}_MODEL`]||null;}
function extractJson(text){
  const raw=String(text||'').trim().replace(/^```json\s*/i,'').replace(/^```/,'').replace(/```$/,'').trim();
  try{return JSON.parse(raw);}catch{}
  const a=raw.indexOf('{'),b=raw.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(raw.slice(a,b+1));}catch{}}
  return null;
}
async function callRootsys({model,messages,temperature=.3,max_tokens=1800}){
  if(!process.env.ROOTSYS_API_KEY) throw new Error('ROOTSYS_API_KEY belum ditetapkan.');
  if(!model) throw new Error('Model AI belum ditetapkan.');
  const r=await fetch(`${ROOTSYS_BASE_URL}/chat/completions`,{
    method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.ROOTSYS_API_KEY}`},
    body:JSON.stringify({model,messages,temperature,max_tokens})
  });
  const text=await r.text();
  let data;try{data=JSON.parse(text);}catch{data=null;}
  if(!r.ok) throw new Error(data?.error?.message||`AI provider HTTP ${r.status}`);
  const content=data?.choices?.[0]?.message?.content;
  if(!content) throw new Error('AI provider tidak memulangkan jawapan.');
  return {content,usage:data?.usage||{}};
}
async function getOwner(supabase){
  const {data,error}=await supabase.from('profiles').select('id,full_name').eq('role','admin').eq('status','active').order('created_at',{ascending:true}).limit(1).maybeSingle();
  if(error) throw error;
  if(!data) throw new Error('Admin aktif tidak ditemui.');
  return data;
}
async function getAgent(supabase,code){
  if(!VALID_AGENTS.has(code)) throw new Error('AI agent tidak sah.');
  const {data,error}=await supabase.from('ai_agents').select('*').eq('code',code).single();
  if(error||!data) throw new Error(`AI agent ${code} belum disediakan.`);
  if(!data.enabled) throw new Error(`${data.display_name} sedang dimatikan.`);
  return data;
}
async function log(supabase,taskId,agentId,userId,action,details={}){
  await supabase.from('ai_activity_logs').insert({task_id:taskId||null,agent_id:agentId||null,actor_user_id:userId||null,action,details});
}
async function setAgentStatus(supabase,code,status){
  await supabase.from('ai_agents').update({status,updated_at:new Date().toISOString()}).eq('code',code);
}
async function createTask(supabase,ownerId,code,instruction,parentId=null,depth=0){
  const agent=await getAgent(supabase,code);
  const approval=code==='marketing'||code==='social_media';
  const {data,error}=await supabase.from('ai_tasks').insert({
    created_by:ownerId,assigned_agent_id:agent.id,parent_task_id:parentId,original_instruction:instruction,
    task_description:instruction,status:'queued',approval_required:approval,approval_status:approval?'pending':'not_required',delegation_depth:depth
  }).select('*').single();
  if(error) throw error;
  await log(supabase,data.id,agent.id,ownerId,'task_created',{agent:code,source:'telegram',parent_task_id:parentId});
  return data;
}
async function recordUsage(supabase,taskId,agentId,model,usage){
  const input=Number(usage?.prompt_tokens??usage?.input_tokens??0),output=Number(usage?.completion_tokens??usage?.output_tokens??0),cached=Number(usage?.prompt_tokens_details?.cached_tokens??usage?.cached_tokens??0),reported=Number(usage?.cost??usage?.total_cost??0);
  await supabase.from('ai_usage').insert({task_id:taskId,agent_id:agentId,provider:'rootsys',model,input_tokens:input,output_tokens:output,cached_tokens:cached,estimated_cost:Number.isFinite(reported)?reported:0,cost_currency:'CNY'});
}
async function marketingContext(supabase){
  const [{data:flavours},{data:knowledge}]=await Promise.all([
    supabase.from('flavours').select('name,selling_price,active').eq('active',true).order('name'),
    supabase.from('business_knowledge').select('category,title,content').eq('approved',true).order('updated_at',{ascending:false}).limit(30)
  ]);
  return JSON.stringify({products:flavours||[],approved_knowledge:knowledge||[]},null,2).slice(0,18000);
}
async function socialContext(supabase){
  const [{data:flavours},{data:knowledge},{data:approved},{data:accounts}]=await Promise.all([
    supabase.from('flavours').select('name,selling_price,active').eq('active',true).order('name'),
    supabase.from('business_knowledge').select('category,title,content').eq('approved',true).order('updated_at',{ascending:false}).limit(20),
    supabase.from('ai_tasks').select('id,result_summary,completed_at,ai_agents!inner(code)').eq('ai_agents.code','marketing').eq('approval_status','approved').order('completed_at',{ascending:false}).limit(10),
    supabase.from('social_accounts').select('platform,account_name,active').eq('active',true).limit(20)
  ]);
  return JSON.stringify({products:flavours||[],approved_knowledge:knowledge||[],approved_marketing_outputs:approved||[],connected_social_accounts:accounts||[]},null,2).slice(0,22000);
}
async function accountingContext(supabase){
  const now=new Date();
  const start=new Date(now.getFullYear(),now.getMonth(),1).toISOString();
  const end=now.toISOString();
  const [{data:sales,error:sErr},{data:expenses,error:eErr},{data:purchases,error:pErr}]=await Promise.all([
    supabase.from('sales').select('total_amount,total_cogs,commission_amount,sale_date,status').eq('status','finalized').gte('sale_date',start).lte('sale_date',end),
    supabase.from('expenses').select('amount,incurred_at').gte('incurred_at',start).lte('incurred_at',end),
    supabase.from('purchases').select('total_cost,purchased_at').gte('purchased_at',start).lte('purchased_at',end)
  ]);
  if(sErr) throw sErr;if(eErr) throw eErr;if(pErr) throw pErr;
  const sum=(rows,key)=>(rows||[]).reduce((n,r)=>n+Number(r[key]||0),0);
  const revenue=sum(sales,'total_amount'),cogs=sum(sales,'total_cogs'),commission=sum(sales,'commission_amount'),operating=sum(expenses,'amount'),stockPurchases=sum(purchases,'total_cost');
  return JSON.stringify({period:{start:start.slice(0,10),end:end.slice(0,10)},revenue,cogs,gross_profit:revenue-cogs,commission_expense:commission,operating_expenses:operating,net_profit:revenue-cogs-commission-operating,stock_purchases:stockPurchases,transactions:(sales||[]).length},null,2);
}
async function executeAgent({supabase,ownerId,task,code,instruction,ownerInstruction}){
  const agent=await getAgent(supabase,code),model=agent.model_name||modelEnv(code);
  await supabase.from('ai_tasks').update({status:'working',started_at:new Date().toISOString()}).eq('id',task.id);
  await setAgentStatus(supabase,code,'working');
  await log(supabase,task.id,agent.id,null,'task_started',{agent:code,source:'telegram'});
  try{
    let system,userMessage=instruction;
    if(code==='marketing'){
      const context=await marketingContext(supabase);
      system=`You are Marketing AI for WAHH AIR. Produce useful marketing work in Malay unless asked otherwise. OWNER instruction is authoritative for task-specific prices, quantities, dates and campaign terms. Do not invent missing business facts. Approved business context is authoritative when owner did not override it. Output is a draft only and requires owner approval before publication.\n\nAPPROVED BUSINESS CONTEXT:\n${context}`;
      userMessage=`OWNER INSTRUCTION:\n${clean(ownerInstruction,8000)}\n\nASSIGNED MARKETING TASK:\n${clean(instruction,8000)}\n\nCreate the requested draft. Do not publish it.`;
    }else if(code==='social_media'){
      const context=await socialContext(supabase);
      system=`You are Social Media Handler AI for WAHH AIR. Prepare platform-ready captions, posting plans and execution drafts. Preserve owner facts and approved marketing meaning. Never claim something was published unless a connector confirms it. Every output requires owner approval.\n\nSOCIAL MEDIA CONTEXT:\n${context}`;
      userMessage=`OWNER INSTRUCTION:\n${clean(ownerInstruction,8000)}\n\nASSIGNED SOCIAL MEDIA TASK:\n${clean(instruction,8000)}\n\nPrepare the requested draft/package.`;
    }else if(code==='accounting'){
      const context=await accountingContext(supabase);
      system=`You are Accounting AI for WAHH AIR. You are READ-ONLY. Use only deterministic figures provided below. Explain them clearly in Malay and never invent figures.\n\nCURRENT MONTH FINANCIAL CONTEXT:\n${context}`;
    }else system='You are Chief AI for WAHH AIR. Give concise management assistance in Malay. Do not invent business facts.';
    const out=await callRootsys({model,messages:[{role:'system',content:system},{role:'user',content:userMessage}],temperature:code==='marketing'?.6:code==='social_media'?.5:.2,max_tokens:2200});
    await recordUsage(supabase,task.id,agent.id,model,out.usage);
    const needsApproval=code==='marketing'||code==='social_media';
    await supabase.from('ai_outputs').insert({task_id:task.id,output_type:'text',title:`${agent.display_name} Output`,content_text:out.content,content_json:{context_type:code,source:'telegram'}});
    await supabase.from('ai_tasks').update({result_summary:out.content,result_json:{agent:code,source:'telegram'},status:needsApproval?'waiting_approval':'completed',completed_at:needsApproval?null:new Date().toISOString(),approval_status:needsApproval?'pending':'not_required'}).eq('id',task.id);
    await setAgentStatus(supabase,code,needsApproval?'waiting_approval':'standby');
    await log(supabase,task.id,agent.id,null,needsApproval?'waiting_approval':'task_completed',{source:'telegram'});
    return {task_id:task.id,agent:code,agent_name:agent.display_name,result:out.content,status:needsApproval?'waiting_approval':'completed'};
  }catch(e){
    await supabase.from('ai_tasks').update({status:'failed',error_message:clean(e.message,2000),completed_at:new Date().toISOString()}).eq('id',task.id);
    await setAgentStatus(supabase,code,'failed');
    await log(supabase,task.id,agent.id,null,'task_failed',{source:'telegram',error:clean(e.message,1000)});
    throw e;
  }
}
async function processNaturalCommand(supabase,instruction){
  instruction=clean(instruction,8000);
  if(!instruction) throw new Error('Arahan kosong.');
  const owner=await getOwner(supabase);
  const chiefTask=await createTask(supabase,owner.id,'chief',instruction,null,0);
  const chief=await getAgent(supabase,'chief');
  await supabase.from('ai_tasks').update({status:'working',started_at:new Date().toISOString()}).eq('id',chiefTask.id);
  await setAgentStatus(supabase,'chief','working');
  try{
    const model=chief.model_name||modelEnv('chief');
    const routed=await callRootsys({model,temperature:.1,max_tokens:900,messages:[
      {role:'system',content:'You are CHIEF AI for WAHH AIR. Route owner instructions only. Return strict JSON only: {"route":"marketing|accounting|social_media|marketing_social|both|chief","reason":"short reason","marketing_task":"... or null","accounting_task":"... or null","social_media_task":"... or null","chief_answer":"... or null"}. Marketing=strategy/copy/offer ideation. Accounting=financial questions. Social_media=platform-ready social execution. marketing_social=marketing plus social execution. both=marketing plus accounting. Preserve exact owner facts.'},
      {role:'user',content:instruction}
    ]});
    await recordUsage(supabase,chiefTask.id,chief.id,model,routed.usage);
    const route=extractJson(routed.content);
    if(!route||!['marketing','accounting','social_media','marketing_social','both','chief'].includes(route.route)) throw new Error('Chief AI routing tidak sah.');
    await log(supabase,chiefTask.id,chief.id,owner.id,'chief_routed',{...route,source:'telegram'});
    const results=[];
    if(route.route==='chief'){
      const answer=clean(route.chief_answer||route.reason,12000);
      await supabase.from('ai_tasks').update({result_summary:answer,result_json:{route,source:'telegram'},status:'completed',approval_status:'not_required',completed_at:new Date().toISOString()}).eq('id',chiefTask.id);
      await setAgentStatus(supabase,'chief','standby');
      results.push({task_id:chiefTask.id,agent:'chief',agent_name:chief.display_name,result:answer,status:'completed'});
      return {route:route.route,results};
    }
    const specs=[];
    if(['marketing','both','marketing_social'].includes(route.route)) specs.push(['marketing',clean(route.marketing_task||instruction,8000)]);
    if(['accounting','both'].includes(route.route)) specs.push(['accounting',clean(route.accounting_task||instruction,8000)]);
    if(['social_media','marketing_social'].includes(route.route)) specs.push(['social_media',clean(route.social_media_task||instruction,8000)]);
    for(const [code,childInstruction] of specs){
      const task=await createTask(supabase,owner.id,code,childInstruction,chiefTask.id,1);
      results.push(await executeAgent({supabase,ownerId:owner.id,task,code,instruction:childInstruction,ownerInstruction:instruction}));
    }
    const summary=results.map(x=>`${x.agent.toUpperCase()}: ${x.result}`).join('\n\n');
    await supabase.from('ai_tasks').update({result_summary:summary,result_json:{route,source:'telegram',children:results.map(x=>({task_id:x.task_id,agent:x.agent,status:x.status}))},status:'completed',approval_status:'not_required',completed_at:new Date().toISOString()}).eq('id',chiefTask.id);
    await setAgentStatus(supabase,'chief','standby');
    return {route:route.route,results};
  }catch(e){
    await supabase.from('ai_tasks').update({status:'failed',error_message:clean(e.message,2000),completed_at:new Date().toISOString()}).eq('id',chiefTask.id);
    await setAgentStatus(supabase,'chief','failed');
    throw e;
  }
}
function agentIcon(code){return ({chief:'🧠',marketing:'📣',accounting:'📊',social_media:'📱'})[code]||'🤖';}
function statusText(status){return status==='waiting_approval'?'🟠 MENUNGGU APPROVAL OWNER':'✅ TASK COMPLETED';}
function formatResult(item,instruction){
  const task=clean(instruction,500);
  const result=clean(item.result,2700);
  return [
    '🤖 <b>WAHH AIR AI OFFICE</b>','',
    `${agentIcon(item.agent)} <b>HANDLED BY</b>`,`<b>${esc(item.agent_name||item.agent)}</b>`,'',
    '📌 <b>TASK</b>',esc(task),'','━━━━━━━━━━━━━━','',
    '📄 <b>RESULT</b>','',esc(result),'','━━━━━━━━━━━━━━','',
    '📍 <b>STATUS</b>',statusText(item.status)
  ].join('\n');
}
function approvalKeyboard(taskId){return {inline_keyboard:[[
  {text:'✅ Approve',callback_data:`ai|approve|${taskId}`},
  {text:'❌ Reject',callback_data:`ai|reject|${taskId}`},
  {text:'✏️ Revise',callback_data:`ai|revise|${taskId}`}
]]};}
async function sendNaturalCommandResult(supabase,chatId,instruction){
  await sendMessage(chatId,'🧠 <b>CHIEF AI</b>\n\nArahan diterima. Chief sedang pilih department dan proses task.\n\n⏳ <b>Sedang diproses...</b>');
  const out=await processNaturalCommand(supabase,instruction);
  for(const item of out.results){
    await sendMessage(chatId,formatResult(item,instruction),item.status==='waiting_approval'?approvalKeyboard(item.task_id):null);
  }
  return out;
}
async function setApprovalFromTelegram(supabase,taskId,decision){
  const map={approve:'approved',reject:'rejected',revise:'revision_requested'};
  const status=map[decision];
  if(!status) throw new Error('Tindakan approval tidak sah.');
  const owner=await getOwner(supabase);
  const {data:task,error}=await supabase.from('ai_tasks').select('id,assigned_agent_id,status,approval_status,ai_agents(code,display_name)').eq('id',taskId).maybeSingle();
  if(error) throw error;
  if(!task) throw new Error('Task tidak ditemui.');
  if(task.approval_status!=='pending'&&task.approval_status!=='revision_requested') return {already:true,status:task.approval_status,agent:task.ai_agents};
  const nextTaskStatus=status==='revision_requested'?'queued':'completed';
  await supabase.from('ai_tasks').update({approval_status:status,status:nextTaskStatus,completed_at:status==='revision_requested'?null:new Date().toISOString()}).eq('id',taskId);
  if(task.assigned_agent_id) await supabase.from('ai_agents').update({status:status==='revision_requested'?'queued':'standby',updated_at:new Date().toISOString()}).eq('id',task.assigned_agent_id);
  await supabase.from('ai_approvals').insert({task_id:taskId,status,owner_feedback:null,decided_by:owner.id,decided_at:new Date().toISOString()});
  await log(supabase,taskId,task.assigned_agent_id,owner.id,`approval_${status}`,{source:'telegram',agent_code:task.ai_agents?.code||null});
  return {already:false,status,agent:task.ai_agents};
}

module.exports={sendNaturalCommandResult,setApprovalFromTelegram};
