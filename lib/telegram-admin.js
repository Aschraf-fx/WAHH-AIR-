const { createClient } = require('@supabase/supabase-js');

function env(name){ return String(process.env[name] || '').trim(); }
function adminChatId(){ return env('TELEGRAM_ADMIN_CHAT_ID'); }
function botToken(){ return env('TELEGRAM_BOT_TOKEN'); }
function webhookSecret(){ return env('TELEGRAM_WEBHOOK_SECRET'); }

function getSupabase(){
  const url = env('SUPABASE_URL') || env('NEXT_PUBLIC_SUPABASE_URL');
  const key = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Missing Supabase server environment variables');
  return createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}

function esc(v=''){
  return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function money(v){ return `RM${Number(v || 0).toFixed(2)}`; }
function dt(v){
  if (!v) return '-';
  return new Intl.DateTimeFormat('ms-MY',{timeZone:'Asia/Kuala_Lumpur',dateStyle:'medium',timeStyle:'short'}).format(new Date(v));
}

async function tg(method,payload){
  const token = botToken();
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN');
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`,{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)
  });
  const out = await r.json().catch(()=>({}));
  if (!r.ok || !out.ok) throw new Error(out.description || `Telegram ${method} failed`);
  return out.result;
}

async function sendMessage(chatId,text,replyMarkup){
  return tg('sendMessage',{chat_id:chatId,text,parse_mode:'HTML',disable_web_page_preview:true,...(replyMarkup?{reply_markup:replyMarkup}:{})});
}
async function sendPhoto(chatId,photo,caption,replyMarkup){
  return tg('sendPhoto',{chat_id:chatId,photo,caption,parse_mode:'HTML',...(replyMarkup?{reply_markup:replyMarkup}:{})});
}
async function answerCallback(id,text=''){
  return tg('answerCallbackQuery',{callback_query_id:id,...(text?{text}:{})});
}

async function getProfileById(supabase,userId){
  const {data:p,error} = await supabase.from('profiles').select('*').eq('id',userId).maybeSingle();
  if (error) throw error;
  if (!p) return null;
  return enrichProfile(supabase,p);
}
async function getProfileByPublicId(supabase,publicId){
  const {data:p,error} = await supabase.from('profiles').select('*').eq('public_id',publicId).maybeSingle();
  if (error) throw error;
  if (!p) return null;
  return enrichProfile(supabase,p);
}
async function enrichProfile(supabase,p){
  let email='-';
  try{
    const {data} = await supabase.auth.admin.getUserById(p.id);
    email = data?.user?.email || '-';
  }catch(_){ }
  let rider=null;
  if (p.role === 'rider') {
    const {data,error} = await supabase.from('rider_applications').select('ic_number,profile_photo_path,terms_text,terms_accepted_at,created_at').eq('user_id',p.id).maybeSingle();
    if (!error) rider=data;
  }
  return {...p,email,rider};
}

async function getYtdStats(supabase,userId){
  const now = new Date();
  const start = `${now.getUTCFullYear()}-01-01T00:00:00.000Z`;
  const {data:sales,error} = await supabase.from('sales')
    .select('id,total_amount,commission_amount,net_to_business')
    .eq('seller_id',userId).eq('status','finalized').gte('sale_date',start);
  if (error) throw error;
  const rows = sales || [];
  const stats = rows.reduce((a,s)=>({
    sales:a.sales+Number(s.total_amount||0),
    commission:a.commission+Number(s.commission_amount||0),
    net:a.net+Number(s.net_to_business||0)
  }),{sales:0,commission:0,net:0});
  let bottles=0;
  const ids=rows.map(x=>x.id);
  if (ids.length){
    const {data:items,error:itemErr} = await supabase.from('sale_items').select('quantity').in('sale_id',ids);
    if (!itemErr) bottles=(items||[]).reduce((n,x)=>n+Number(x.quantity||0),0);
  }
  return {...stats,bottles,count:rows.length,year:now.getUTCFullYear()};
}

function profileText(p,stats,{registration=false}={}){
  const roleLabel=p.role==='rider'?'RIDER':'EJEN';
  const title=registration?`🆕 <b>PENDAFTARAN ${roleLabel} BARU</b>`:`👤 <b>PROFIL ${roleLabel}</b>`;
  const lines=[
    title,'',
    `<b>Nama:</b> ${esc(p.full_name)}`,
    `<b>Public ID:</b> ${esc(p.public_id)}`,
    `<b>Telefon:</b> ${esc(p.phone||'-')}`,
    `<b>Email:</b> ${esc(p.email||'-')}`,
    `<b>Status:</b> ${esc(p.status||'-')}`,
    `<b>Tarikh daftar:</b> ${esc(dt(p.created_at))}`
  ];
  if (p.role==='rider'){
    lines.push(`<b>No. IC:</b> ${esc(p.rider?.ic_number||'-')}`);
    lines.push(`<b>T&C diterima:</b> ${esc(dt(p.rider?.terms_accepted_at))}`);
  }
  lines.push('',`📊 <b>PRESTASI ${stats.year} YTD</b>`,
    `<b>Transaksi:</b> ${stats.count}`,
    `<b>Botol terjual:</b> ${stats.bottles}`,
    `<b>Nilai jualan:</b> ${money(stats.sales)}`,
    `<b>Komisen:</b> ${money(stats.commission)}`,
    `<b>Kepada owner:</b> ${money(stats.net)}`
  );
  return lines.join('\n');
}

async function signedRiderPhoto(supabase,p){
  const path=p?.rider?.profile_photo_path;
  if (!path) return '';
  const {data,error}=await supabase.storage.from('rider-profiles').createSignedUrl(path,300);
  if (error) return '';
  return data?.signedUrl || '';
}

function personKeyboard(p){
  return {inline_keyboard:[
    [{text:'📊 Refresh YTD',callback_data:`p|${p.public_id}`}],
    [{text:p.role==='rider'?'◀️ Senarai Rider':'◀️ Senarai Ejen',callback_data:`l|${p.role}|0`}],
    [{text:'🏠 Menu',callback_data:'menu'}]
  ]};
}
async function sendProfileCard(supabase,chatId,p,{registration=false}={}){
  const stats=await getYtdStats(supabase,p.id);
  const text=profileText(p,stats,{registration});
  const keyboard=personKeyboard(p);
  if (p.role==='rider'){
    const photo=await signedRiderPhoto(supabase,p);
    if (photo) await sendPhoto(chatId,photo,text.slice(0,1024),keyboard);
    else await sendMessage(chatId,text,keyboard);
    if (p.rider?.terms_text) await sendMessage(chatId,`📜 <b>T&C Rider</b>\n\n${esc(p.rider.terms_text)}`);
  } else {
    await sendMessage(chatId,text,keyboard);
  }
}

async function sendMainMenu(chatId){
  return sendMessage(chatId,'🏠 <b>WAHH AIR ADMIN BOT</b>\n\nPilih kategori:',{
    inline_keyboard:[[{text:'🛵 Rider',callback_data:'l|rider|0'},{text:'🤝 Ejen',callback_data:'l|agent|0'}]]
  });
}

async function sendList(supabase,chatId,role,page=0){
  const size=8;
  page=Math.max(0,Number(page)||0);
  const from=page*size,to=from+size-1;
  const {data,error,count}=await supabase.from('profiles').select('public_id,full_name,status',{count:'exact'})
    .eq('role',role).order('created_at',{ascending:false}).range(from,to);
  if(error) throw error;
  const rows=data||[];
  const title=role==='rider'?'🛵 <b>SENARAI RIDER</b>':'🤝 <b>SENARAI EJEN</b>';
  const buttons=rows.map(p=>[{text:`${p.public_id} • ${p.full_name}`,callback_data:`p|${p.public_id}`}]);
  const nav=[];
  if(page>0) nav.push({text:'◀️',callback_data:`l|${role}|${page-1}`});
  nav.push({text:`Page ${page+1}`,callback_data:'noop'});
  if((count||0)>to+1) nav.push({text:'▶️',callback_data:`l|${role}|${page+1}`});
  buttons.push(nav,[{text:'🏠 Menu',callback_data:'menu'}]);
  return sendMessage(chatId,`${title}\n\nJumlah: <b>${count||0}</b>`,{inline_keyboard:buttons});
}

module.exports={
  adminChatId,webhookSecret,getSupabase,sendMessage,sendPhoto,answerCallback,
  getProfileById,getProfileByPublicId,getYtdStats,sendProfileCard,sendMainMenu,sendList,esc
};
