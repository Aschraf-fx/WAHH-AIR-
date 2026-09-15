const {
  adminChatId,getSupabase,getProfileById,sendProfileCard
}=require('../lib/telegram-admin');

module.exports=async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='POST') return res.status(405).json({error:'Method not allowed'});

  try{
    const userId=String(req.body?.userId||'').trim();
    if(!/^[0-9a-f-]{36}$/i.test(userId)) return res.status(400).json({error:'Invalid user'});

    const chatId=adminChatId();
    if(!chatId) return res.status(503).json({error:'Telegram admin chat is not configured'});
    const supabase=getSupabase();

    const {data:done,error:checkErr}=await supabase.from('audit_logs')
      .select('id').eq('action','telegram_registration_notified').eq('entity_type','profile').eq('entity_id',userId).limit(1);
    if(checkErr) throw checkErr;
    if(done?.length) return res.status(200).json({ok:true,duplicate:true});

    const profile=await getProfileById(supabase,userId);
    if(!profile) return res.status(404).json({error:'Profile not ready'});
    if(!['rider','agent'].includes(profile.role)) return res.status(200).json({ok:true,ignored:true});

    await sendProfileCard(supabase,chatId,profile,{registration:true});
    await supabase.from('audit_logs').insert({
      actor_id:null,action:'telegram_registration_notified',entity_type:'profile',entity_id:userId,
      details:{public_id:profile.public_id,role:profile.role}
    });
    return res.status(200).json({ok:true});
  }catch(err){
    console.error('Telegram registration notify error:',err);
    return res.status(500).json({error:'Telegram notification failed'});
  }
};
