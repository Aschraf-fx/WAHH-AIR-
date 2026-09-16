(function(){
  const original=window.adminPosters;
  if(typeof original!=='function') return;

  function publicVideoUrl(path){
    return state.supabase.storage.from('promo-videos').getPublicUrl(path).data.publicUrl;
  }

  async function renderPromoVideoManager(root){
    const {data,error}=await state.supabase.from('promo_videos').select('*').order('created_at',{ascending:false});
    if(error) throw error;
    const rows=data||[];
    const wrap=document.createElement('section');
    wrap.className='panel';
    wrap.innerHTML=`
      <div class="panel-head"><div><h3>Video Promosi Portrait</h3><p>Upload MP4 9:16 untuk slot iklan di homepage. Hanya satu video boleh aktif pada satu masa.</p></div></div>
      <form id="promoVideoAdminForm" class="form-stack">
        <label>Title<input id="promoVideoTitle" required placeholder="Contoh: WAHH AIR Event Promo"></label>
        <label class="file-drop">Pilih video portrait
          <input id="promoVideoFile" type="file" accept="video/mp4,video/webm,video/quicktime" required>
        </label>
        <div class="muted">Cadangan: 9:16, MP4, bawah 25MB. Video akan autoplay secara muted di homepage.</div>
        <button class="btn primary" type="submit">Upload Video Promosi</button>
      </form>
      <div class="table-wrap" style="margin-top:18px"><table class="data-table">
        <thead><tr><th>Video</th><th>Title</th><th>Status</th><th>Tindakan</th></tr></thead>
        <tbody>${rows.length?rows.map(r=>`<tr>
          <td><video src="${esc(publicVideoUrl(r.storage_path))}" muted playsinline preload="metadata" style="width:72px;aspect-ratio:9/16;object-fit:cover;border-radius:10px;background:#111"></video></td>
          <td><strong>${esc(r.title)}</strong><br><span class="muted">${esc(r.storage_path)}</span></td>
          <td><span class="status-badge ${r.active?'active':'terminated'}">${r.active?'Active':'Inactive'}</span></td>
          <td><div class="row-actions" style="margin:0;justify-content:flex-start">
            <button class="btn sm ${r.active?'ghost':'success'} promo-video-toggle" data-id="${r.id}" data-active="${!r.active}">${r.active?'Hide':'Show'}</button>
            <button class="btn sm danger promo-video-delete" data-id="${r.id}" data-path="${esc(r.storage_path)}">Delete</button>
          </div></td>
        </tr>`).join(''):tableEmpty(4,'Belum ada video promosi.')}</tbody>
      </table></div>`;
    root.appendChild(wrap);

    $('#promoVideoAdminForm',wrap).addEventListener('submit',async e=>{
      e.preventDefault();
      const file=$('#promoVideoFile',wrap).files[0];
      if(!file) return;
      if(file.size>25*1024*1024) return toast('Video terlalu besar. Maksimum 25MB.','error');
      const allowed=['video/mp4','video/webm','video/quicktime'];
      if(file.type&&!allowed.includes(file.type)) return toast('Format video tidak disokong. Gunakan MP4, WebM atau MOV.','error');
      const ext=(file.name.split('.').pop()||'mp4').toLowerCase().replace(/[^a-z0-9]/g,'')||'mp4';
      const path=`${Date.now()}-${crypto.randomUUID()}.${ext}`;
      const b=e.submitter;
      setBusy(b,true,'Uploading...');
      const up=await state.supabase.storage.from('promo-videos').upload(path,file,{upsert:false,contentType:file.type||'video/mp4'});
      if(up.error){setBusy(b,false);return toast(up.error.message,'error');}

      const off=await state.supabase.from('promo_videos').update({active:false,updated_at:new Date().toISOString()}).eq('active',true);
      if(off.error){
        await state.supabase.storage.from('promo-videos').remove([path]);
        setBusy(b,false);
        return toast(off.error.message,'error');
      }
      const ins=await state.supabase.from('promo_videos').insert({title:$('#promoVideoTitle',wrap).value.trim(),storage_path:path,active:true});
      if(ins.error){
        await state.supabase.storage.from('promo-videos').remove([path]);
        setBusy(b,false);
        return toast(ins.error.message,'error');
      }
      setBusy(b,false);
      toast('Video promosi berjaya dimuat naik dan diaktifkan.','success');
      renderView('posters');
    });

    $$('.promo-video-toggle',wrap).forEach(b=>b.addEventListener('click',async()=>{
      const makeActive=b.dataset.active==='true';
      if(makeActive){
        const off=await state.supabase.from('promo_videos').update({active:false,updated_at:new Date().toISOString()}).eq('active',true);
        if(off.error) return toast(off.error.message,'error');
      }
      const {error}=await state.supabase.from('promo_videos').update({active:makeActive,updated_at:new Date().toISOString()}).eq('id',b.dataset.id);
      if(error) return toast(error.message,'error');
      toast(makeActive?'Video promosi diaktifkan.':'Video promosi disembunyikan.','success');
      renderView('posters');
    }));

    $$('.promo-video-delete',wrap).forEach(b=>b.addEventListener('click',async()=>{
      const ok=await confirmAction('Delete video promosi?','Video akan dipadam daripada database dan Supabase Storage.');
      if(!ok) return;
      const del=await state.supabase.from('promo_videos').delete().eq('id',b.dataset.id);
      if(del.error) return toast(del.error.message,'error');
      const rm=await state.supabase.storage.from('promo-videos').remove([b.dataset.path]);
      if(rm.error) console.warn('Promo video storage delete failed:',rm.error);
      toast('Video promosi dipadam.','success');
      renderView('posters');
    }));
  }

  window.adminPosters=async function(root){
    await original(root);
    try{await renderPromoVideoManager(root);}
    catch(e){
      console.error('Promo video admin error:',e);
      const box=document.createElement('section');
      box.className='panel empty-state';
      box.innerHTML=`<strong>Video Promosi belum tersedia</strong><br>${esc(e.message||'Jalankan migration promo video dahulu.')}`;
      root.appendChild(box);
    }
  };
})();
