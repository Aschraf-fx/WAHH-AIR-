(function(){
  /* No static mp4 fallback: assets/promo-sidebar.mp4 does not exist in the repo
     (404), so pointing the <video> at it left a dead black panel. When no
     managed video is available we now rely on the built-in CSS fallback panel
     that already ships inside the ad markup. */
  const WA_MESSAGE='Hi Admin WAHH AIR! Saya nampak video promosi di website dan nak tahu lebih lanjut.';

  function normalizeWhatsAppNumber(raw=''){
    let digits=String(raw).replace(/\D/g,'');
    if(!digits)return '';
    if(digits.startsWith('0'))digits=`60${digits.slice(1)}`;
    if(!digits.startsWith('60')&&digits.length>=9&&digits.length<=11)digits=`60${digits}`;
    return digits;
  }

  async function getPublicClient(){
    if(typeof window.getSharedPublicClient==='function')return window.getSharedPublicClient();
    const res=await fetch('/api/config',{cache:'no-store'});
    if(!res.ok)throw new Error('Config tidak tersedia');
    const cfg=await res.json();
    if(!cfg.supabaseUrl||!cfg.supabaseAnonKey||!window.supabase)throw new Error('Supabase config tidak lengkap');
    return window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{auth:{persistSession:false,autoRefreshToken:false}});
  }

  async function resolveVideoSource(client){
    try{
      const {data,error}=await client.from('promo_videos').select('storage_path,title').eq('active',true).order('created_at',{ascending:false}).limit(1).maybeSingle();
      if(error)throw error;
      if(!data?.storage_path)return {src:'',title:'WAHH AIR! untuk event & majlis',managed:false};
      const url=client.storage.from('promo-videos').getPublicUrl(data.storage_path).data.publicUrl;
      return {src:url,title:data.title||'WAHH AIR! untuk event & majlis',managed:true};
    }catch(err){
      console.warn('Managed promo video unavailable, using fallback panel:',err);
      return {src:'',title:'WAHH AIR! untuk event & majlis',managed:false};
    }
  }

  function buildAd(videoInfo){
    const publicApp=document.getElementById('publicApp');
    if(!publicApp||document.getElementById('promoVideoAd'))return null;
    const hasVideo=!!videoInfo.src;

    const aside=document.createElement('aside');
    aside.id='promoVideoAd';
    aside.className=hasVideo?'promo-video-ad':'promo-video-ad is-fallback';
    aside.setAttribute('aria-label','Iklan promosi WAHH AIR');
    aside.innerHTML=`
      <span class="promo-video-ad__label">Iklan / Promosi</span>
      <button class="promo-video-ad__close" type="button" aria-label="Tutup iklan">×</button>
      <a class="promo-video-ad__link" id="promoVideoLink" href="#" aria-label="Hubungi WAHH AIR melalui WhatsApp">
        <div class="promo-video-ad__media">
          ${hasVideo?`<video id="promoVideoPlayer" data-src="${videoInfo.src}" autoplay muted loop playsinline preload="none" poster="assets/logo.jpg"></video>`:''}
          <div class="promo-video-ad__fallback" aria-hidden="true">
            <div>
              <img src="assets/logo.jpg" alt="" />
              <strong>WAHH AIR!</strong>
              <span>Video promosi akan dipaparkan di sini.</span>
            </div>
          </div>
        </div>
        <div class="promo-video-ad__cta">
          <strong>${String(videoInfo.title||'WAHH AIR! untuk event & majlis').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}</strong>
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
    if(!video)markFallback();

    /* Load the promo video only when the slot is actually visible. It used to
       start fetching on page load, which cost 11.6 MB twice (the mp4 has its
       moov atom at the tail, so the browser issues a range request after the
       first pass). */
    const loadVideo=()=>{
      if(!video||video.dataset.loaded==='1')return;
      video.dataset.loaded='1';
      video.src=video.dataset.src||'';
      video.play().catch(()=>{});
    };
    if(video){
      if('IntersectionObserver' in window){
        const io=new IntersectionObserver(entries=>{
          entries.forEach(entry=>{ if(entry.isIntersecting){ loadVideo(); io.disconnect(); } });
        },{rootMargin:'200px'});
        io.observe(video);
      } else {
        loadVideo();
      }
    }

    try{if(sessionStorage.getItem('wahhPromoVideoClosed')==='1')aside.hidden=true;}catch(_){ }
    return aside;
  }

  async function attachWhatsApp(aside,client){
    if(!aside)return;
    const link=aside.querySelector('#promoVideoLink');
    if(!link)return;
    try{
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

  async function initPromoVideo(){
    try{
      const client=await getPublicClient();
      const videoInfo=await resolveVideoSource(client);
      const aside=buildAd(videoInfo);
      await attachWhatsApp(aside,client);
    }catch(err){
      console.warn('Promo video init fallback:',err);
      buildAd({src:'',title:'WAHH AIR! untuk event & majlis',managed:false});
    }
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',initPromoVideo,{once:true});
  }else{
    initPromoVideo();
  }
})();
