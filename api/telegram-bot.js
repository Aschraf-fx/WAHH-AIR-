const {
  adminChatId,webhookSecret,getSupabase,answerCallback,
  getProfileByPublicId,sendProfileCard,sendMainMenu,sendList
}=require('../lib/telegram-admin');

function authorizedChat(update){
  const allowed=adminChatId();
  if(!allowed) return false;
  const chat=update?.message?.chat?.id ?? update?.callback_query?.message?.chat?.id;
  return String(chat||'')===String(allowed);
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
      const text=String(update.message.text||'').trim().toLowerCase();
      if(['/start','/menu','menu'].includes(text)) await sendMainMenu(chatId);
      else if(text==='/rider') await sendList(supabase,chatId,'rider',0);
      else if(text==='/ejen' || text==='/agent') await sendList(supabase,chatId,'agent',0);
      else await sendMainMenu(chatId);
      return res.status(200).json({ok:true});
    }

    const cb=update.callback_query;
    if(cb){
      const data=String(cb.data||'');
      await answerCallback(cb.id).catch(()=>{});
      if(data==='noop') return res.status(200).json({ok:true});
      if(data==='menu'){
        await sendMainMenu(chatId);
        return res.status(200).json({ok:true});
      }
      if(data.startsWith('l|')){
        const [,role,page]=data.split('|');
        if(['rider','agent'].includes(role)) await sendList(supabase,chatId,role,Number(page)||0);
        return res.status(200).json({ok:true});
      }
      if(data.startsWith('p|')){
        const publicId=data.slice(2);
        const profile=await getProfileByPublicId(supabase,publicId);
        if(profile) await sendProfileCard(supabase,chatId,profile);
        return res.status(200).json({ok:true});
      }
    }

    return res.status(200).json({ok:true});
  }catch(err){
    console.error('Telegram bot webhook error:',err);
    return res.status(200).json({ok:true});
  }
};
