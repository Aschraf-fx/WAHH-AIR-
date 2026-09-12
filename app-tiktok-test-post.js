(function(){
  const MAX_BYTES=64*1024*1024;
  let injecting=false;
  let currentCreator=null;
  let previewUrl=null;

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
      wrap.innerHTML='<button class="btn primary" id="tiktokTestPostBtn" type="button">Test TikTok Post</button><span class="muted">Direct Post test ikut Creator Info TikTok semasa</span>';
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
    modal.innerHTML=`<div class="modal-card" style="max-width:720px;width:min(94vw,720px);max-height:92vh;overflow:auto">
      <div class="modal-head"><h3>🎵 TikTok Test Post</h3><button class="icon-btn" type="button" data-close>×</button></div>
      <div id="tiktokCreatorBox" class="muted" style="margin-bottom:14px">Loading creator info...</div>
      <form id="tiktokTestPostForm" class="form-stack">
        <label>Video test
          <input id="tiktokVideoFile" type="file" accept="video/mp4,video/quicktime,video/webm" required>
          <span class="muted">MP4 / MOV / WebM • maksimum 64MB untuk V1</span>
        </label>
        <div id="tiktokVideoPreviewWrap" class="hidden" style="padding:10px;border:1px solid var(--border,#ddd);border-radius:12px">
          <div class="muted" id="tiktokVideoMeta" style="margin-bottom:8px"></div>
          <video id="tiktokVideoPreview" controls playsinline style="display:block;width:100%;max-height:320px;border-radius:10px;background:#000"></video>
        </div>
        <label>Caption
          <textarea id="tiktokCaption" rows="4" maxlength="2200" placeholder="Contoh: WAHH AIR! Pilihan minuman sejuk untuk majlis anda 🥤" required></textarea>
        </label>
        <label>Privacy
          <select id="tiktokPrivacy" required disabled>
            <option value="">Pilih privacy...</option>
          </select>
          <span class="muted">Pilihan ini datang terus daripada Creator Info TikTok. Tiada pilihan dipilih secara automatik.</span>
        </label>
        <div style="padding:12px;border:1px solid var(--border,#ddd);border-radius:12px">
          <strong>Interaction settings</strong>
          <div class="muted" style="margin:4px 0 10px">Pilih sendiri apa yang anda mahu benarkan. Pilihan yang TikTok tidak benarkan akan dikunci.</div>
          <label style="display:flex;align-items:center;gap:8px;margin:6px 0"><input id="tiktokAllowComment" type="checkbox"> Benarkan komen</label>
          <label style="display:flex;align-items:center;gap:8px;margin:6px 0"><input id="tiktokAllowDuet" type="checkbox"> Benarkan Duet</label>
          <label style="display:flex;align-items:center;gap:8px;margin:6px 0"><input id="tiktokAllowStitch" type="checkbox"> Benarkan Stitch</label>
        </div>
        <label style="display:flex;align-items:flex-start;gap:8px"><input id="tiktokConsent" type="checkbox" required style="margin-top:3px"> <span>Saya telah semak video, caption, privacy dan interaction settings ini dan saya bersetuju menghantar kandungan ini ke TikTok.</span></label>
        <div id="tiktokPostProgress" class="muted"></div>
        <div class="row-actions"><button class="btn primary" id="tiktokPostSubmit" type="submit">Approve & Post to TikTok</button><button class="btn ghost" type="button" data-close>Batal</button></div>
      </form>
    </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click',e=>{if(e.target===modal||e.target.closest('[data-close]'))closeModal(modal);});
    modal.querySelector('#tiktokTestPostForm').addEventListener('submit',submitTestPost);
    modal.querySelector('#tiktokVideoFile').addEventListener('change',()=>renderVideoPreview(modal));
    modal.querySelector('#tiktokPrivacy').addEventListener('change',()=>syncInteractionControls(modal));
    return modal;
  }

  function closeModal(modal){
    modal.classList.add('hidden');
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
  }

  function renderVideoPreview(modal){
    const file=modal.querySelector('#tiktokVideoFile').files?.[0];
    const wrap=modal.querySelector('#tiktokVideoPreviewWrap');
    const video=modal.querySelector('#tiktokVideoPreview');
    const meta=modal.querySelector('#tiktokVideoMeta');
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
    if(!file){wrap.classList.add('hidden');video.removeAttribute('src');return;}
    previewUrl=URL.createObjectURL(file);
    video.src=previewUrl;
    meta.textContent=`${file.name} • ${(file.size/1024/1024).toFixed(2)} MB`;
    wrap.classList.remove('hidden');
  }

  function privacyLabel(v){
    return ({
      PUBLIC_TO_EVERYONE:'Public to everyone',
      MUTUAL_FOLLOW_FRIENDS:'Friends / mutual followers',
      FOLLOWER_OF_CREATOR:'Followers of creator',
      SELF_ONLY:'Only me / private'
    })[v]||v;
  }

  function syncInteractionControls(modal){
    const c=currentCreator||{};
    const privacy=modal.querySelector('#tiktokPrivacy').value;
    const comment=modal.querySelector('#tiktokAllowComment');
    const duet=modal.querySelector('#tiktokAllowDuet');
    const stitch=modal.querySelector('#tiktokAllowStitch');

    comment.disabled=c.comment_disabled===true;
    if(comment.disabled)comment.checked=false;

    const privatePost=privacy==='SELF_ONLY';
    duet.disabled=c.duet_disabled===true||privatePost;
    stitch.disabled=c.stitch_disabled===true||privatePost;
    if(duet.disabled)duet.checked=false;
    if(stitch.disabled)stitch.checked=false;
  }

  async function openTestPost(){
    const modal=ensureModal();
    const form=modal.querySelector('#tiktokTestPostForm');
    const box=modal.querySelector('#tiktokCreatorBox');
    const progress=modal.querySelector('#tiktokPostProgress');
    const privacySelect=modal.querySelector('#tiktokPrivacy');
    currentCreator=null;
    progress.textContent='';
    form.reset();
    privacySelect.innerHTML='<option value="">Pilih privacy...</option>';
    privacySelect.disabled=true;
    modal.querySelector('#tiktokVideoPreviewWrap').classList.add('hidden');
    if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}
    modal.classList.remove('hidden');
    box.textContent='Loading creator info...';
    try{
      const r=await api({action:'creator_info'});
      const c=r.creator||{};
      currentCreator=c;
      const privacy=Array.isArray(c.privacy_level_options)?c.privacy_level_options:[];
      if(!privacy.length)throw new Error('TikTok tidak pulangkan pilihan privacy untuk akaun ini.');
      privacy.forEach(v=>{
        const o=document.createElement('option');
        o.value=v;o.textContent=privacyLabel(v);
        privacySelect.appendChild(o);
      });
      privacySelect.disabled=false;
      box.innerHTML=`<strong>${escHtml(c.creator_nickname||c.creator_username||'TikTok Creator')}</strong>${c.creator_username?` <span class="muted">@${escHtml(c.creator_username)}</span>`:''}<br><span>Privacy tersedia: ${escHtml(privacy.join(', '))}</span>${c.max_video_post_duration_sec?`<br><span>Max duration: ${Number(c.max_video_post_duration_sec)}s</span>`:''}`;
      syncInteractionControls(modal);
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
    const privacy=modal.querySelector('#tiktokPrivacy').value;
    const allowComment=modal.querySelector('#tiktokAllowComment').checked;
    const allowDuet=modal.querySelector('#tiktokAllowDuet').checked;
    const allowStitch=modal.querySelector('#tiktokAllowStitch').checked;
    const consent=modal.querySelector('#tiktokConsent').checked;
    const btn=modal.querySelector('#tiktokPostSubmit');
    const progress=modal.querySelector('#tiktokPostProgress');
    if(!currentCreator)return toast('Creator Info belum siap. Tutup dan buka semula Test TikTok Post.','error');
    if(!file)return toast('Pilih video dulu.','error');
    if(!caption)return toast('Masukkan caption.','error');
    if(!privacy)return toast('Pilih privacy TikTok dulu.','error');
    if(!consent)return toast('Sahkan persetujuan sebelum post.','error');
    if(file.size>MAX_BYTES)return toast('Video V1 maksimum 64MB.','error');
    if(!['video/mp4','video/quicktime','video/webm'].includes(file.type))return toast('Gunakan MP4, MOV atau WebM.','error');

    const ok=window.confirm(`Hantar video ini ke TikTok?\n\nPrivacy: ${privacyLabel(privacy)}\nCaption: ${caption.slice(0,120)}${caption.length>120?'…':''}`);
    if(!ok)return;

    setBusy(btn,true,'Preparing...');
    try{
      progress.textContent='1/3 • Meminta TikTok upload URL...';
      const init=await api({
        action:'init_test_post',
        caption,
        file_size:file.size,
        file_type:file.type,
        privacy_level:privacy,
        allow_comment:allowComment,
        allow_duet:allowDuet,
        allow_stitch:allowStitch
      });

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
        toast('TikTok test post berjaya.','success');
        progress.innerHTML='<strong>✅ PUBLISH_COMPLETE</strong> • Video berjaya dihantar ke TikTok.';
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

  function escHtml(v=''){return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[c]));}

  const observer=new MutationObserver(()=>injectButton());
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',injectButton);
  setTimeout(injectButton,1000);
})();
