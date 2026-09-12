const {
  adminChatId,webhookSecret,getSupabase,answerCallback,
  getProfileByPublicId,sendProfileCard,sendList,sendMessage
}=require('../lib/telegram-admin');
const {setApprovalFromTelegram}=require('../lib/telegram-ai-office');
const {handleConversation,resetConversation}=require('../lib/telegram-chief-chat');

function authorizedChat(update){
  const allowed=adminChatId();
  if(!allowed) return false;
  const chat=update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
  return String(chat||'')===String(allowed);
}

async function getOwnerId(supabase){
  const {data,error}=await supabase.from('profiles').select('id').eq('role','admin').eq('status','active').order('created_at',{ascending:true}).limit(1).maybeSingle();
  if(error) throw error;
  if(!data?.id) throw new Error('Admin aktif tidak ditemui.');
  return data.id;
}

async function setChiefMode(supabase,chatId,active){
  const key=String(chatId);
  const {data,error}=await supabase.from('telegram_ai_conversations').select('id,active').eq('chat_id',key).maybeSingle();
  if(error) throw error;
  if(data){
    const upd=await supabase.from('telegram_ai_conversations').update({active:Boolean(active),updated_at:new Date().toISOString()}).eq('id',data.id);
    if(upd.error) throw upd.error;
    return Boolean(active);
  }
  if(!active) return false;
  const ownerId=await getOwnerId(supabase);
  const ins=await supabase.from('telegram_ai_conversations').insert({chat_id:key,owner_id:ownerId,active:true});
  if(ins.error) throw ins.error;
  return true;
}

async function chiefModeActive(supabase,chatId){
  const {data,error}=await supabase.from('telegram_ai_conversations').select('active').eq('chat_id',String(chatId)).maybeSingle();
  if(error) throw error;
  return data?.active===true;
}

function homeKeyboard(){
  return {inline_keyboard:[
    [{text:'🧠 Chat Chief AI',callback_data:'chief|enter'}],
    [{text:'🛵 Rider',callback_data:'l|rider|0'},{text:'🤝 Ejen',callback_data:'l|agent|0'}]
  ]};
}

function chiefKeyboard(){
  return {inline_keyboard:[
    [{text:'🆕 New Conversation',callback_data:'chief|new'},{text:'🏠 Home',callback_data:'menu'}]
  ]};
}

async function sendHomeMenu(chatId){
  return sendMessage(chatId,'🏠 <b>WAHH AIR ADMIN BOT</b>\n\nPilih menu:',homeKeyboard());
}

async function sendChiefMode(chatId,resume=true){
  const text=resume
    ?'🧠 <b>CHIEF AI MODE</b>\n\nKau sekarang sedang berbual terus dengan Chief AI. Conversation lama masih disimpan, jadi kau boleh sambung topik sebelum ini.\n\nChief boleh berbincang, research, create temporary AI dan serahkan arahan kepada Marketing, Accounting atau Social Media.\n\nTaip mesej biasa untuk mula.'
    :'🧠 <b>CHIEF AI MODE</b>\n\nConversation baru telah dimulakan. Taip mesej biasa untuk berbual dengan Chief AI.';
  return sendMessage(chatId,text,chiefKeyboard());
}

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});

  try{
    const secret=webhookSecret();
    const received=String(req.headers['x-telegram-bot-api-secret-token']||'');
    if(!secret || received!==secret) return res.status(401).json({error:'Unauthorized'});

    const update=req.body||{};
    if(!authorizedChat(update)) return res.status(200).json({ok:true,ignored:true});

    const supabase=getSupabase();
    const chatId=adminChatId();

    if(update.message){
      const raw=String(update.message.text||'').trim();
      const text=raw.toLowerCase();
      if(['/start','/menu','menu','home'].includes(text)){
        await setChiefMode(supabase,chatId,false);
        await sendHomeMenu(chatId);
      }
      else if(text==='/rider'){
        await setChiefMode(supabase,chatId,false);
        await sendList(supabase,chatId,'rider',0);
      }
      else if(text==='/ejen' || text==='/agent'){
        await setChiefMode(supabase,chatId,false);
        await sendList(supabase,chatId,'agent',0);
      }
      else if(text==='/new' || text==='/reset'){
        await setChiefMode(supabase,chatId,true);
        await resetConversation(supabase,chatId);
        await sendChiefMode(chatId,false);
      }
      else if(raw){
        try{
          if(await chiefModeActive(supabase,chatId)){
            await handleConversation(supabase,chatId,raw);
          }else{
            await sendHomeMenu(chatId);
          }
        }catch(aiErr){
          console.error('Telegram Chief conversation error:',aiErr);
          await sendMessage(chatId,`⚠️ <b>AI OFFICE GAGAL</b>\n\n${String(aiErr.message||'Ralat tidak diketahui').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}`,chiefKeyboard());
        }
      }else await sendHomeMenu(chatId);
      return res.status(200).json({ok:true});
    }

    const cb=update.callback_query;
    if(cb){
      const data=String(cb.data||'');
      await answerCallback(cb.id).catch(()=>{});
      if(data==='noop') return res.status(200).json({ok:true});
      if(data==='menu'){
        await setChiefMode(supabase,chatId,false);
        await sendHomeMenu(chatId);
        return res.status(200).json({ok:true});
      }
      if(data==='chief|enter'){
        await setChiefMode(supabase,chatId,true);
        await sendChiefMode(chatId,true);
        return res.status(200).json({ok:true});
      }
      if(data==='chief|new'){
        await setChiefMode(supabase,chatId,true);
        await resetConversation(supabase,chatId);
        await sendChiefMode(chatId,false);
        return res.status(200).json({ok:true});
      }
      if(data.startsWith('l|')){
        await setChiefMode(supabase,chatId,false);
        const [,role,page]=data.split('|');
        if(['rider','agent'].includes(role)) await sendList(supabase,chatId,role,Number(page)||0);
        return res.status(200).json({ok:true});
      }
      if(data.startsWith('p|')){
        await setChiefMode(supabase,chatId,false);
        const publicId=data.slice(2);
        const profile=await getProfileByPublicId(supabase,publicId);
        if(profile) await sendProfileCard(supabase,chatId,profile);
        return res.status(200).json({ok:true});
      }
      if(data.startsWith('ai|')){
        const [,decision,taskId]=data.split('|');
        try{
          const r=await setApprovalFromTelegram(supabase,taskId,decision);
          if(r.already){
            await sendMessage(chatId,`ℹ️ <b>AI OFFICE</b>\n\nTask ini sudah diproses.\nStatus: <b>${String(r.status||'-').toUpperCase()}</b>`,chiefKeyboard());
          }else if(decision==='approve'){
            await sendMessage(chatId,'✅ <b>APPROVED</b>\n\nTask telah diluluskan dan status AI Office telah diselaraskan.',chiefKeyboard());
          }else if(decision==='reject'){
            await sendMessage(chatId,'❌ <b>REJECTED</b>\n\nTask telah ditolak dan status AI Office telah diselaraskan.',chiefKeyboard());
          }else if(decision==='revise'){
            await setChiefMode(supabase,chatId,true);
            await sendMessage(chatId,'✏️ <b>REVISION REQUESTED</b>\n\nTask telah ditandakan untuk revision. Kau boleh terus taip arahan pembetulan kepada Chief AI.',chiefKeyboard());
          }
        }catch(e){
          console.error('Telegram approval callback error:',e);
          await sendMessage(chatId,`⚠️ <b>APPROVAL GAGAL</b>\n\n${String(e.message||'Ralat tidak diketahui').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}`,chiefKeyboard());
        }
        return res.status(200).json({ok:true});
      }
    }

    return res.status(200).json({ok:true});
  }catch(err){
    console.error('Telegram bot webhook error:',err);
    return res.status(200).json({ok:true});
  }
};
