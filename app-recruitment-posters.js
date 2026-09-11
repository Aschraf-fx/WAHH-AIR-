/* Separate public promo posters from Rider/Ejen recruitment posters. */
async function loadPublic() {
  if (!state.supabase) return;

  const posterQuery = state.supabase
    .from('posters')
    .select('id,title,storage_path,created_at,category')
    .eq('active', true)
    .order('sort_order')
    .order('created_at', { ascending:false });

  const [fl, stock, members, posterResult] = await Promise.all([
    state.supabase.from('flavours').select('id,name,selling_price,active').eq('active', true).order('name'),
    state.supabase.rpc('get_public_flavour_stock'),
    state.supabase.rpc('get_public_members'),
    posterQuery
  ]);

  let posters = posterResult.data || [];
  if (posterResult.error && /category/i.test(posterResult.error.message || '')) {
    const fallback = await state.supabase
      .from('posters')
      .select('id,title,storage_path,created_at')
      .eq('active', true)
      .order('sort_order')
      .order('created_at', { ascending:false });
    posters = (fallback.data || []).map(p => ({...p, category:'promo'}));
  }

  state.flavours = fl.data || [];
  renderPublicPosters(posters.filter(p => (p.category || 'promo') === 'promo'));
  renderRecruitmentPosters(posters.filter(p => p.category === 'recruitment'));
  renderPublicStock(stock.data || []);
  renderPublicMembers(members.data || []);
}

function renderRecruitmentPosters(rows) {
  const grid = $('#recruitmentPosterGrid');
  if (!grid) return;
  if (!rows.length) {
    grid.innerHTML = `<div class="recruitment-placeholder"><strong>Poster peluang pendapatan akan muncul di sini.</strong><span>Admin boleh upload poster khas Rider / Ejen dari Portal.</span></div>`;
    return;
  }
  grid.innerHTML = rows.map(p => {
    const { data } = state.supabase.storage.from('posters').getPublicUrl(p.storage_path);
    return `<article class="poster-card"><img src="${esc(data.publicUrl)}" alt="${esc(p.title)}"><div class="poster-meta"><strong>${esc(p.title)}</strong><span>Jom Jadi Rider / Ejen WAHH AIR</span></div></article>`;
  }).join('');
}

async function adminPosters(root){
  let {data,error}=await state.supabase.from('posters').select('*').order('sort_order').order('created_at',{ascending:false});
  let hasCategory=true;
  if(error && /category/i.test(error.message || '')){
    hasCategory=false;
    const fallback=await state.supabase.from('posters').select('id,title,storage_path,active,sort_order,created_at').order('sort_order').order('created_at',{ascending:false});
    data=(fallback.data||[]).map(p=>({...p,category:'promo'}));
    error=fallback.error;
  }
  if(error)throw error;

  root.innerHTML=pageHead('CONTENT','Poster WAHH AIR','Asingkan poster Promosi Produk dan poster Jana Pendapatan Rider/Ejen.')+`
    <section class="panel">
      <form id="posterForm" class="form-stack">
        <label>Jenis Poster
          <select id="posterCategory" ${hasCategory?'':'disabled'}>
            <option value="promo">Promosi Produk</option>
            <option value="recruitment">Jana Pendapatan / Rider & Ejen</option>
          </select>
        </label>
        ${hasCategory?'':'<div class="muted">Jalankan supabase/07-poster-categories.sql untuk aktifkan kategori poster recruitment.</div>'}
        <label>Title<input id="posterTitle" required></label>
        <label class="file-drop">Pilih gambar<input id="posterFile" type="file" accept="image/*" required></label>
        <button class="btn primary" type="submit">Upload Poster</button>
      </form>
    </section>
    <section class="panel">
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Title</th><th>Jenis</th><th>Path</th><th>Status</th><th></th></tr></thead>
        <tbody>${data?.length?data.map(r=>`<tr><td><strong>${esc(r.title)}</strong></td><td>${r.category==='recruitment'?'Jana Pendapatan':'Promosi'}</td><td>${esc(r.storage_path)}</td><td>${r.active?'Active':'Inactive'}</td><td><button class="btn sm ghost poster-toggle" data-id="${r.id}" data-active="${!r.active}">${r.active?'Hide':'Show'}</button></td></tr>`).join(''):tableEmpty(5)}</tbody>
      </table></div>
    </section>`;

  $('#posterForm',root).addEventListener('submit',async e=>{
    e.preventDefault();
    const file=$('#posterFile').files[0];
    if(!file)return;
    if(!hasCategory)return toast('Jalankan migration poster category dahulu.','warning');
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
    const path=`${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const b=e.submitter;
    setBusy(b,true,'Uploading...');
    const up=await state.supabase.storage.from('posters').upload(path,file,{upsert:false,contentType:file.type});
    if(up.error){setBusy(b,false);return toast(up.error.message,'error');}
    const ins=await state.supabase.from('posters').insert({title:$('#posterTitle').value.trim(),storage_path:path,active:true,category:$('#posterCategory').value});
    setBusy(b,false);
    if(ins.error)return toast(ins.error.message,'error');
    toast('Poster berjaya dimuat naik.','success');
    await loadPublic();
    renderView('posters');
  });

  $$('.poster-toggle',root).forEach(b=>b.addEventListener('click',async()=>{
    const{error}=await state.supabase.from('posters').update({active:b.dataset.active==='true'}).eq('id',b.dataset.id);
    if(error)return toast(error.message,'error');
    await loadPublic();
    renderView('posters');
  }));
}
