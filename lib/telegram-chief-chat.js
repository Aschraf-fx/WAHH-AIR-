const {sendMessage,esc}=require('./telegram-admin');
const {sendNaturalCommandResult}=require('./telegram-ai-office');

const ROOTSYS_BASE_URL=(process.env.ROOTSYS_BASE_URL||'https://rootsys.cloud/v1').replace(/\/$/,'');

function clean(v,max=12000){return String(v||'').trim().slice(0,max);}
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
  if(!model) throw new Error('Model AI belum ditetapkan untuk Chief AI.');
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
  if(error)throw error;
  if(!data)throw new Error('Admin aktif tidak ditemui.');
  return data;
}
async function getChiefModel(supabase){
  const {data,error}=await supabase.from('ai_agents').select('model_name,enabled').eq('code','chief').maybeSingle();
  if(error)throw error;
  if(!data||!data.enabled)throw new Error('Chief AI belum aktif.');
  return data.model_name||modelEnv('chief');
}
async function getConversation(supabase,chatId,ownerId){
  const key=String(chatId);
  let {data,error}=await supabase.from('telegram_ai_conversations').select('*').eq('chat_id',key).maybeSingle();
  if(error)throw error;
  if(!data){
    const ins=await supabase.from('telegram_ai_conversations').insert({chat_id:key,owner_id:ownerId,active:true}).select('*').single();
    if(ins.error)throw ins.error;
    data=ins.data;
  }
  if(!data.active){
    const upd=await supabase.from('telegram_ai_conversations').update({active:true,updated_at:new Date().toISOString()}).eq('id',data.id).select('*').single();
    if(upd.error)throw upd.error;
    data=upd.data;
  }
  return data;
}
async function addMessage(supabase,conversationId,role,content,messageType='chat',metadata={}){
  const {error}=await supabase.from('telegram_ai_messages').insert({conversation_id:conversationId,role,content:clean(content,12000),message_type:messageType,metadata});
  if(error)throw error;
  await supabase.from('telegram_ai_conversations').update({updated_at:new Date().toISOString()}).eq('id',conversationId);
}
async function recentMessages(supabase,conversationId,limit=24){
  const {data,error}=await supabase.from('telegram_ai_messages').select('role,content,message_type,created_at').eq('conversation_id',conversationId).order('created_at',{ascending:false}).limit(limit);
  if(error)throw error;
  return (data||[]).reverse();
}
function buildDepartmentHandoff(history,message){
  const recent=(history||[]).slice(-12).map(x=>{
    const who=x.role==='assistant'?'CHIEF/AI OFFICE':'OWNER';
    return `${who}: ${clean(x.content,1800)}`;
  }).join('\n');
  return clean(`CURRENT OWNER REQUEST:\n${message}\n\nRECENT CONVERSATION CONTEXT:\n${recent||'Tiada konteks terdahulu.'}\n\nHANDOFF RULES:\n- CURRENT OWNER REQUEST is the newest authoritative instruction.\n- Use RECENT CONVERSATION CONTEXT to preserve the exact subject, proposal, figures, recommendation and reasoning already discussed.\n- CHIEF/AI OFFICE messages are context, not independent owner approval.\n- If owner says send/pass/forward/serahkan/suruh a department to continue something discussed earlier, execute that handoff now.\n- The receiving department must answer the handed-off subject, not start an unrelated fresh topic.`,8000);
}
async function activeSpecialists(supabase,ownerId){
  await supabase.from('ai_temporary_agents').update({status:'expired',updated_at:new Date().toISOString()}).eq('owner_id',ownerId).eq('status','active').lt('expires_at',new Date().toISOString());
  const {data,error}=await supabase.from('ai_temporary_agents').select('id,name,purpose,system_prompt,model_name,expires_at').eq('owner_id',ownerId).eq('status','active').gt('expires_at',new Date().toISOString()).order('created_at',{ascending:false}).limit(5);
  if(error)throw error;
  return data||[];
}
async function classifyIntent({model,message,history,specialists}){
  const specialistText=specialists.length?specialists.map(x=>`${x.name}: ${x.purpose}`).join('\n'):'Tiada temporary specialist aktif.';
  const hist=history.slice(-12).map(x=>`${x.role.toUpperCase()}: ${x.content}`).join('\n');
  const out=await callRootsys({model,temperature:.1,max_tokens=900,messages:[
    {role:'system',content:`You are the conversational CHIEF AI for WAHH AIR on Telegram. Decide what the owner's latest message means. Return strict JSON only with this schema:\n{"mode":"chat|task|research|create_specialist|use_specialist","reason":"short","reply":"chat reply or null","research_query":"query or null","specialist_name":"name or null","specialist_purpose":"purpose or null","specialist_prompt":"system prompt or null"}.\n\nRules:\n- chat = discussion, brainstorming, clarification, follow-up, opinions, explanations. Do NOT create a task for normal conversation.\n- task = owner clearly asks for work/action that should use the existing AI Office departments (marketing/accounting/social media/chief task execution).\n- If owner says send/pass/forward/serahkan/suruh Marketing, Accounting or Social Media to do something discussed earlier, ALWAYS classify as task. Chief CAN hand conversation context to those departments through AI Office.\n- Short follow-ups such as "suruh marketing buat yang ni", "hantar dekat marketing", "bagi accounting semak benda tadi", or "social media teruskan cadangan tu" MUST use RECENT CONVERSATION to identify the handed-off subject.\n- research = owner explicitly asks to research/check/find current external/public information.\n- create_specialist = owner explicitly asks to create/add a temporary AI specialist. Only create when clearly requested.\n- use_specialist = owner asks an existing temporary specialist to do something.\n- Preserve Malay casual context and understand short follow-ups from conversation history.\n- Never tell owner Chief has no authority to send information to a department; this handoff is supported.\n- Never claim web research was done unless research mode is actually used.\n\nACTIVE TEMP SPECIALISTS:\n${specialistText}\n\nRECENT CONVERSATION:\n${hist||'Tiada.'}`},
    {role:'user',content:message}
  ]});
  const parsed=extractJson(out.content);
  if(!parsed||!['chat','task','research','create_specialist','use_specialist'].includes(parsed.mode)) throw new Error('Chief conversation classifier tidak sah.');
  return parsed;
}
async function chatReply({model,message,history,specialists}){
  const hist=history.slice(-20).map(x=>({role:x.role==='assistant'?'assistant':'user',content:x.content}));
  const specs=specialists.length?specialists.map(x=>`- ${x.name}: ${x.purpose} (expires ${x.expires_at})`).join('\n'):'- Tiada';
  const out=await callRootsys({model,temperature:.45,max_tokens:1400,messages:[
    {role:'system',content:`You are Chief AI for WAHH AIR chatting directly with the owner on Telegram. Speak naturally in Malay, concise and useful. You can discuss ideas and remember the recent conversation. You ARE allowed to hand the current discussion and your recommendations to Marketing, Accounting or Social Media when the owner asks; AI Office will execute that handoff. Never tell owner you lack authority to send information to a department. Do not pretend a task, web research, publication, payment, or database change happened unless it actually happened. A clear request for a department to act should become a task, not merely a chat reply. Active temporary specialists:\n${specs}`},
    ...hist,
    {role:'user',content:message}
  ]});
  return clean(out.content,3500);
}
async function webResearch(query){
  const key=String(process.env.TAVILY_API_KEY||'').trim();
  if(!key) throw new Error('TAVILY_API_KEY tidak tersedia');
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),15000);
  try{
    const r=await fetch('https://api.tavily.com/search',{
      method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
      body:JSON.stringify({api_key:key,query,search_depth:'advanced',include_answer:true,max_results:6,include_raw_content:false})
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data?.detail||data?.message||`Tavily HTTP ${r.status}`);
    if(!Array.isArray(data.results)||!data.results.length)throw new Error('Tavily tidak memulangkan hasil carian');
    return data;
  }finally{clearTimeout(timer);}
}
async function researchReply({model,query,message}){
  const searchQuery=query||message;
  try{
    const research=await webResearch(searchQuery);
    const sources=(research.results||[]).map((r,i)=>({n:i+1,title:r.title,url:r.url,content:clean(r.content,1800)}));
    const out=await callRootsys({model,temperature:.2,max_tokens:1900,messages:[
      {role:'system',content:'You are Research Specialist for WAHH AIR. Summarize current web research in Malay. Be concise, distinguish facts from inference, and cite source numbers like [1], [2]. Never invent unsupported claims.'},
      {role:'user',content:`OWNER REQUEST:\n${message}\n\nSEARCH QUERY:\n${searchQuery}\n\nWEB RESULTS:\n${JSON.stringify(sources,null,2)}`}
    ]});
    return {answer:clean(out.content,3200),sources,provider:'tavily',live:true,fallback_reason:null};
  }catch(tavilyErr){
    const fallback=await callRootsys({model,temperature:.25,max_tokens:1900,messages:[
      {role:'system',content:'You are Research Specialist for WAHH AIR. Tavily live web search is unavailable, so answer using your own model knowledge only. Be useful and concise in Malay. Explicitly avoid claiming that you searched the live web, avoid pretending information is current when uncertain, and flag facts that may require live verification.'},
      {role:'user',content:`OWNER REQUEST:\n${message}\n\nRESEARCH TOPIC:\n${searchQuery}`}
    ]});
    return {answer:clean(fallback.content,3200),sources:[],provider:'rootsys',live:false,fallback_reason:clean(tavilyErr?.message||'Tavily unavailable',500)};
  }
}
async function createSpecialist({supabase,owner,conversation,classification,model}){
  const current=await activeSpecialists(supabase,owner.id);
  if(current.length>=5) throw new Error('Maksimum 5 temporary AI aktif. Matikan/biarkan salah satu expire dulu.');
  const name=clean(classification.specialist_name||'Temporary Specialist',80);
  const purpose=clean(classification.specialist_purpose||classification.reason||'Temporary specialist requested by owner',500);
  const prompt=clean(classification.specialist_prompt||`You are ${name}, a temporary specialist for WAHH AIR. Focus only on: ${purpose}. Give concise, practical Malay answers. Do not perform irreversible actions or claim external actions occurred without a real connector.`,4000);
  const expires=new Date(Date.now()+24*60*60*1000).toISOString();
  const {data,error}=await supabase.from('ai_temporary_agents').insert({owner_id:owner.id,conversation_id:conversation.id,name,purpose,system_prompt:prompt,model_name:process.env.ROOTSYS_TEMP_AGENT_MODEL||model,status:'active',expires_at:expires}).select('*').single();
  if(error)throw error;
  return data;
}
async function useSpecialist({supabase,ownerId,name,message,history,defaultModel}){
  const specs=await activeSpecialists(supabase,ownerId);
  let spec=null;
  if(name) spec=specs.find(x=>x.name.toLowerCase()===String(name).toLowerCase())||specs.find(x=>x.name.toLowerCase().includes(String(name).toLowerCase()));
  if(!spec&&specs.length===1)spec=specs[0];
  if(!spec)throw new Error('Temporary AI yang diminta tidak ditemui atau sudah expired.');
  const hist=history.slice(-12).map(x=>({role:x.role==='assistant'?'assistant':'user',content:x.content}));
  const out=await callRootsys({model:spec.model_name||defaultModel,temperature:.35,max_tokens:1800,messages:[
    {role:'system',content:`${spec.system_prompt}\n\nYou are temporary and advisory. Do not create permanent business records or perform external actions unless an authorized connector explicitly does so.`},
    ...hist,
    {role:'user',content:message}
  ]});
  return {spec,answer:clean(out.content,3500)};
}
function sourceBlock(sources){
  if(!sources?.length)return '';
  const rows=sources.slice(0,5).map(s=>`[${s.n}] ${esc(s.title||'Source')}\n${esc(s.url||'')}`);
  return `\n\n🔎 <b>SOURCES</b>\n${rows.join('\n\n')}`;
}
async function resetConversation(supabase,chatId){
  const owner=await getOwner(supabase);
  const conversation=await getConversation(supabase,chatId,owner.id);
  await supabase.from('telegram_ai_messages').delete().eq('conversation_id',conversation.id);
  await supabase.from('ai_temporary_agents').update({status:'disabled',updated_at:new Date().toISOString()}).eq('conversation_id',conversation.id).eq('status','active');
  await sendMessage(chatId,'🧠 <b>CHIEF AI</b>\n\nConversation baru dimulakan. Memory chat lama dan temporary AI untuk session ini telah dikosongkan.');
}
async function handleConversation(supabase,chatId,message){
  const owner=await getOwner(supabase);
  const conversation=await getConversation(supabase,chatId,owner.id);
  const history=await recentMessages(supabase,conversation.id,24);
  const specialists=await activeSpecialists(supabase,owner.id);
  const model=await getChiefModel(supabase);
  await addMessage(supabase,conversation.id,'user',message,'chat');
  const decision=await classifyIntent({model,message,history,specialists});

  if(decision.mode==='task'){
    const handoff=buildDepartmentHandoff(history,message);
    await addMessage(supabase,conversation.id,'assistant','Arahan dan konteks perbualan diserahkan kepada AI Office department.','task',{decision,handoff:true});
    return sendNaturalCommandResult(supabase,chatId,handoff);
  }
  if(decision.mode==='research'){
    await sendMessage(chatId,'🔎 <b>RESEARCH AI</b>\n\nSedang buat research...');
    const r=await researchReply({model,query:decision.research_query,message});
    const modeLabel=r.live?'🌐 <b>LIVE WEB RESEARCH</b>':'🧠 <b>AI RESEARCH FALLBACK</b>';
    const notice=r.live?'':`\n\n⚠️ <i>Tavily tidak tersedia. Jawapan ini menggunakan Rootsys AI dan bukan live web verified.</i>`;
    const text=`${modeLabel}\n\n${esc(r.answer)}${sourceBlock(r.sources)}${notice}`;
    await addMessage(supabase,conversation.id,'assistant',r.answer,'research',{query:decision.research_query,provider:r.provider,live:r.live,fallback_reason:r.fallback_reason,sources:r.sources.map(s=>({title:s.title,url:s.url}))});
    return sendMessage(chatId,text);
  }
  if(decision.mode==='create_specialist'){
    const spec=await createSpecialist({supabase,owner,conversation,classification:decision,model});
    const answer=`🤖 <b>TEMPORARY AI CREATED</b>\n\n<b>${esc(spec.name)}</b>\n\n🎯 <b>Purpose</b>\n${esc(spec.purpose)}\n\n⏳ <b>Tempoh</b>\n24 jam\n\nKau boleh terus cakap biasa, contoh: <i>“Suruh ${esc(spec.name)} semak benda ni…”</i>`;
    await addMessage(supabase,conversation.id,'assistant',`Temporary AI ${spec.name} created for: ${spec.purpose}`,'specialist',{specialist_id:spec.id});
    return sendMessage(chatId,answer);
  }
  if(decision.mode==='use_specialist'){
    const r=await useSpecialist({supabase,ownerId:owner.id,name:decision.specialist_name,message,history:await recentMessages(supabase,conversation.id,24),defaultModel:model});
    await addMessage(supabase,conversation.id,'assistant',r.answer,'specialist',{specialist_id:r.spec.id,specialist_name:r.spec.name});
    return sendMessage(chatId,`🤖 <b>${esc(r.spec.name.toUpperCase())}</b>\n\n${esc(r.answer)}`);
  }

  const answer=await chatReply({model,message,history:await recentMessages(supabase,conversation.id,24),specialists});
  await addMessage(supabase,conversation.id,'assistant',answer,'chat',{decision});
  return sendMessage(chatId,`🧠 <b>CHIEF AI</b>\n\n${esc(answer)}`);
}

module.exports={handleConversation,resetConversation};
