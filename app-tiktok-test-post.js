(function(){
  const MAX_BYTES=64*1024*1024;
  let injecting=false;

  async function api(payload){
    const token=state.session?.access_token;
    if(!token)throw new Error('Session login tiada.');
    const r=await fetch('/api/tiktok',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(payload)});
    const data=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
    return data;
  }

  function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

  function findTikTokPanel(){
    return Array.from(document.querySelectorAll('section.panel')).find(s=>{
      const h=s.querySelector('h3');
      return h&&h.textContent.includes('TikTok Connection');
    });
  }

  function injectButton(){
    if(injecting)return;
    injecting=true;
    try{
      const panel=findTikTokPanel();
      if(!panel||panel.querySelector('#tiktokTestPostBtn'))return;
      const connected=Array.from(panel.querySelectorAll('.ai-status')).some(x=>x.textContent.trim()==='CONNECTED');
      if(!connected)return;
      const wrap=document.createElement('div');
      wrap.className='row-actions';
      wrap.style.marginTop='16px';
      wrap.innerHTML='<button class="btn primary" id="tiktokTestPostBtn" type="button">Test TikTok Post</button><span class="muted">Private / SELF_ONLY untuk sandbox test</span>';
      panel.appendChild(wrap);
      wrap.querySelector('#tiktokTestPostBtn').onclick=openTestPost;
    }finally{injecting=false;}
  }

  function ensureModal(){
    let modal=document.querySelector('#tiktokTestPostModal');
    if(modal)return modal;
    modal=document.createElement('div');
    modal.id='tiktokTestPostModal';
    modal.className='modal hidden';
    modal.innerHTML=`<div class="modal-card" style="max-width:680px;width:min(94vw,680px)">
      <div class="modal-head"><h3>🎵 TikTok Test Post</h3><button class="icon-btn" type="button" data-close>×</button></div>
      <div id="tiktokCreatorBox" class="muted" style="margin-bottom:14px">Loading creator info...</div>
      <form id="tiktokTestPostForm" class="form-stack">
        <label>Video test
          <input id="tiktokVideoFile" type="file" accept="video/mp4,video/quicktime,video/webm" required>
          <span class="muted">MP4 / MOV / WebM • maksimum 64MB untuk V1</span>
        </label>
        <label>Caption
          <textarea id="tiktokCaption" rows="4" maxlength="2200" placeholder="Contoh: WAHH AIR! Pilihan minuman sejuk untuk majlis anda 🥤" required></textarea>
        </label>
        <div style="padding:12px;border:1px solid var(--border,#ddd);border-radius:12px">
          <strong>Privacy: SELF_ONLY</strong>
          <div class="muted" style="margin-top:4px">Test sandbox/private sahaja. Post tidak akan dipaksa public.</div>
        </div>
        <div id="tiktokPostProgress" class="muted"></div>
        <div class="row-actions"><button class="btn primary" id="tiktokPostSubmit" type="submit">Approve & Post Private</button><button class="btn ghost" type="button" data-close>Batal</button></div>
      </form>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-close]'))modal.classList.add('hidden');});
    modal.querySelector('#tiktokTestPostForm').addEventListener('submit',submitTestPost);
    return modal;
  }

  async function openTestPost(){
    const modal=ensureModal();
    const box=modal.querySelector('#tiktokCreatorBox');
    const progress=modal.querySelector('#tiktokPostProgress');
    progress.textContent='';
    modal.classList.remove('hidden');
    box.textContent='Loading creator info...';
    try{
      const r=await api({action:'creator_info'});
      const c=r.creator||{};
      const privacy=(c.privacy_level_options||[]).join(', ')||'-';
      box.innerHTML=`<strong>${escHtml(c.creator_nickname||c.creator_username||'TikTok Creator')}</strong><br><span>Privacy tersedia: ${escHtml(privacy)}</span>${c.max_video_post_duration_sec?`<br><span>Max duration: ${Number(c.max_video_post_duration_sec)}s</span>`:''}`;
      if(!(c.privacy_level_options||[]).includes('SELF_ONLY'))throw new Error('Akaun ini tidak menawarkan SELF_ONLY buat masa ini.');
    }catch(e){
      box.innerHTML=`<span class="profit-negative">${escHtml(e.message)}</span>`;
      toast(e.message,'error');
    }
  }

  async function submitTestPost(e){
    e.preventDefault();
    const modal=ensureModal();
    const file=modal.querySelector('#tiktokVideoFile').files?.[0];
    const caption=modal.querySelector('#tiktokCaption').value.trim();
    const btn=modal.querySelector('#tiktokPostSubmit');
    const progress=modal.querySelector('#tiktokPostProgress');
    if(!file)return toast('Pilih video dulu.','error');
    if(!caption)return toast('Masukkan caption.','error');
    if(file.size>MAX_BYTES)return toast('Video V1 maksimum 64MB.','error');
    if(!['video/mp4','video/quicktime','video/webm'].includes(file.type))return toast('Gunakan MP4, MOV atau WebM.','error');

    setBusy(btn,true,'Preparing...');
    try{
      progress.textContent='1/3 • Meminta TikTok upload URL...';
      const init=await api({action:'init_test_post',caption,file_size:file.size,file_type:file.type});

      progress.textContent='2/3 • Upload video terus ke TikTok...';
      const upload=await fetch(init.upload_url,{
        method:'PUT',
        headers:{
          'Content-Type':file.type,
          'Content-Range':`bytes 0-${file.size-1}/${file.size}`
        },
        body:file
      });
      if(!upload.ok)throw new Error(`Upload TikTok gagal (HTTP ${upload.status}).`);

      progress.textContent='3/3 • TikTok sedang process video...';
      let finalStatus=null;
      for(let i=0;i<20;i++){
        await sleep(i===0?1500:3000);
        const s=await api({action:'publish_status',publish_id:init.publish_id,post_id:init.post_id});
        finalStatus=s.status||{};
        const st=String(finalStatus.status||'UNKNOWN');
        progress.textContent=`3/3 • Status: ${st}${finalStatus.uploaded_bytes!=null?` • ${Number(finalStatus.uploaded_bytes).toLocaleString()} bytes`:''}`;
        if(st==='PUBLISH_COMPLETE'||st==='FAILED')break;
      }

      if(finalStatus?.status==='PUBLISH_COMPLETE'){
        toast('TikTok private test post berjaya.','success');
        progress.innerHTML='<strong>✅ PUBLISH_COMPLETE</strong> • Video private berjaya dihantar ke TikTok.';
      }else if(finalStatus?.status==='FAILED'){
        throw new Error(`TikTok publish gagal: ${finalStatus.fail_reason||'unknown reason'}`);
      }else{
        toast('Video dah dihantar. TikTok masih processing; check semula kemudian.','success');
        progress.textContent=`Video dah dihantar. Status terakhir: ${finalStatus?.status||'PROCESSING'}.`;
      }
    }catch(err){
      progress.innerHTML=`<span class="profit-negative">${escHtml(err.message)}</span>`;
      toast(err.message,'error');
    }finally{
      setBusy(btn,false);
    }
  }

  function escHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));}

  const observer=new MutationObserver(()=>injectButton());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',injectButton);
  setTimeout(injectButton,1000);
})();
