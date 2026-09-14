(function(){
  const VIDEO_SRC='assets/promo-sidebar.mp4';
  const WA_MESSAGE='Hi Admin WAHH AIR! Saya nampak video promosi di website dan nak tahu lebih lanjut.';

  function normalizeWhatsAppNumber(raw=''){
    let digits=String(raw).replace(/\D/g,'');
    if(!digits)return '';
    if(digits.startsWith('0'))digits=`60${digits.slice(1)}`;
    if(!digits.startsWith('60')&&digits.length>=9&&digits.length<=11)digits=`60${digits}`;
    return digits;
  }

  function buildAd(){
    const publicApp=document.getElementById('publicApp');
    if(!publicApp||document.getElementById('promoVideoAd'))return null;

    const aside=document.createElement('aside');
    aside.id='promoVideoAd';
    aside.className='promo-video-ad';
    aside.setAttribute('aria-label','Iklan promosi WAHH AIR');
    aside.innerHTML=`
      <span class="promo-video-ad__label">Iklan / Promosi</span>
      <button class="promo-video-ad__close" type="button" aria-label="Tutup iklan">×</button>
      <a class="promo-video-ad__link" id="promoVideoLink" href="#" aria-label="Hubungi WAHH AIR melalui WhatsApp">
        <div class="promo-video-ad__media">
          <video id="promoVideoPlayer" src="${VIDEO_SRC}" autoplay muted loop playsinline preload="metadata" poster="assets/logo.jpg"></video>
          <div class="promo-video-ad__fallback" aria-hidden="true">
            <div>
              <img src="assets/logo.jpg" alt="" />
              <strong>WAHH AIR!</strong>
              <span>Video promosi akan dipaparkan di sini.</span>
            </div>
          </div>
        </div>
        <div class="promo-video-ad__cta">
          <strong>WAHH AIR! untuk event & majlis</strong>
          <span>Tekan untuk tanya harga atau tempahan.</span>
          <b>💬 WhatsApp Kami</b>
        </div>
      </a>`;

    const hero=publicApp.querySelector('.hero');
    if(hero&&hero.nextSibling)publicApp.insertBefore(aside,hero.nextSibling);
    else publicApp.appendChild(aside);

    aside.querySelector('.promo-video-ad__close')?.addEventListener('click',()=>{
      aside.hidden=true;
      try{sessionStorage.setItem('wahhPromoVideoClosed','1');}catch(_){ }
    });

    const video=aside.querySelector('#promoVideoPlayer');
    const markFallback=()=>aside.classList.add('is-fallback');
    video?.addEventListener('error',markFallback,{once:true});
    video?.play().catch(()=>{});

    try{if(sessionStorage.getItem('wahhPromoVideoClosed')==='1')aside.hidden=true;}catch(_){ }
    return aside;
  }

  async function attachWhatsApp(aside){
    if(!aside)return;
    const link=aside.querySelector('#promoVideoLink');
    if(!link)return;
    try{
      const res=await fetch('/api/config',{cache:'no-store'});
      if(!res.ok)throw new Error('Config tidak tersedia');
      const cfg=await res.json();
      if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||!window.supabase)throw new Error('Supabase config tidak lengkap');
      const client=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false}});
      const {data,error}=await client.rpc('get_public_admin_contact');
      if(error)throw error;
      const row=Array.isArray(data)?data[0]:data;
      const number=normalizeWhatsAppNumber(row?.phone||'');
      if(!number)throw new Error('Nombor WhatsApp admin tidak tersedia');
      link.href=`https://wa.me/${number}?text=${encodeURIComponent(WA_MESSAGE)}`;
      link.target='_blank';
      link.rel='noopener noreferrer';
    }catch(err){
      console.warn('Promo video WhatsApp unavailable:',err);
      link.addEventListener('click',e=>e.preventDefault());
    }
  }

  document.addEventListener('DOMContentLoaded',()=>{
    const aside=buildAd();
    attachWhatsApp(aside);
  });
})();
