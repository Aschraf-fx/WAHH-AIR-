/* Separate public promo, recruitment and Event/Wedding posters without requiring a DB schema change.
   Category is encoded in storage_path: promo/<file>, recruitment/<file> or event/<file>.
   Existing non-prefixed poster paths are treated as promo. */
function posterCategoryFromPath(path='') {
  const p=String(path);
  if (p.startsWith('recruitment/')) return 'recruitment';
  if (p.startsWith('event/')) return 'event';
  return 'promo';
}

async function loadPublic() {
  if (!state.supabase) return;

  const [fl, stock, members, posterResult] = await Promise.all([
    state.supabase.from('flavours').select('id,name,selling_price,active').eq('active', true).order('name'),
    state.supabase.rpc('get_public_flavour_stock'),
    state.supabase.rpc('get_public_members'),
    state.supabase
      .from('posters')
      .select('id,title,storage_path,created_at,active,sort_order')
      .eq('active', true)
      .order('sort_order')
      .order('created_at', { ascending:false })
  ]);

  const posters = (posterResult.data || []).map(p => ({...p, category:posterCategoryFromPath(p.storage_path)}));

  state.flavours = fl.data || [];
  renderPublicPosters(posters.filter(p => p.category === 'promo'));
  renderRecruitmentPosters(posters.filter(p => p.category === 'recruitment'));
  renderEventPoster(posters.filter(p => p.category === 'event'));
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
    const card = `<article class="poster-card"><img src="${esc(data.publicUrl)}" alt="${esc(p.title)}"><div class="poster-meta"><strong>${esc(p.title)}</strong><span>Jom Jadi Rider / Ejen WAHH AIR</span></div></article>`;
    const title = p.title || '';
    const isRider = /rider/i.test(title);
    const isAgent = /ejen|agent/i.test(title);
    if (isRider && !isAgent) return `<a href="/program-rider.html" aria-label="Baca Program Rider WAHH AIR">${card}</a>`;
    if (isAgent && !isRider) return `<a href="/program-ejen.html" aria-label="Baca Program Ejen WAHH AIR">${card}</a>`;
    return card;
  }).join('');
}

function renderEventPoster(rows){
  const img=$('#eventSupplyPosterImage');
  const placeholder=$('#eventSupplyPosterPlaceholder');
  if(!img||!placeholder)return;
  const p=rows[0];
  if(!p){
    img.hidden=true;
    img.removeAttribute('src');
    placeholder.hidden=false;
    return;
  }
  const {data}=state.supabase.storage.from('posters').getPublicUrl(p.storage_path);
  img.src=data.publicUrl;
  img.alt=p.title||'Poster WAHH AIR untuk majlis';
  img.hidden=false;
  placeholder.hidden=true;
}

async function adminPosters(root){
  const {data,error}=await state.supabase.from('posters').select('id,title,storage_path,active,sort_order,created_at').order('sort_order').order('created_at',{ascending:false});
  if(error)throw error;
  const rows=(data||[]).map(p=>({...p,category:posterCategoryFromPath(p.storage_path)}));
  const labelForCategory=c=>c==='recruitment'?'Jana Pendapatan':c==='event'?'Event / Wedding':'Promosi';

  root.innerHTML=pageHead('CONTENT','Poster WAHH AIR','Urus poster Promosi Produk, Jana Pendapatan dan Event / Wedding.')+`
    <section class="panel">
      <form id="posterForm" class="form-stack">
        <label>Jenis Poster
          <select id="posterCategory">
            <option value="promo">Promosi Produk</option>
            <option value="recruitment">Jana Pendapatan / Rider & Ejen</option>
            <option value="event">Event / Wedding (1920 × 1080)</option>
          </select>
        </label>
        <label>Title<input id="posterTitle" required></label>
        <label class="file-drop">Pilih gambar<input id="posterFile" type="file" accept="image/*" required></label>
        <p class="muted">Untuk Event / Wedding, gunakan poster landscape 1920 × 1080. Hanya satu poster Event aktif akan dipaparkan pada satu-satu masa.</p>
        <button class="btn primary" type="submit">Upload Poster</button>
      </form>
    </section>
    <section class="panel">
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Title</th><th>Jenis</th><th>Path</th><th>Status</th><th></th></tr></thead>
        <tbody>${rows.length?rows.map(r=>`<tr><td><strong>${esc(r.title)}</strong></td><td>${labelForCategory(r.category)}</td><td>${esc(r.storage_path)}</td><td>${r.active?'Active':'Inactive'}</td><td><button class="btn sm ghost poster-toggle" data-id="${r.id}" data-category="${r.category}" data-active="${!r.active}">${r.active?'Hide':'Show'}</button></td></tr>`).join(''):tableEmpty(5)}</tbody>
      </table></div>
    </section>`;

  $('#posterForm',root).addEventListener('submit',async e=>{
    e.preventDefault();
    const file=$('#posterFile').files[0];
    if(!file)return;
    const selected=$('#posterCategory').value;
    const category=['promo','recruitment','event'].includes(selected)?selected:'promo';
    const ext=(file.name.split('.').pop()||'jpg').toLowerCase();
    const path=`${category}/${Date.now()}-${crypto.randomUUID()}.${ext}`;
    const b=e.submitter;
    setBusy(b,true,'Uploading...');
    const up=await state.supabase.storage.from('posters').upload(path,file,{upsert:false,contentType:file.type});
    if(up.error){setBusy(b,false);return toast(up.error.message,'error');}

    if(category==='event'){
      const off=await state.supabase.from('posters').update({active:false}).like('storage_path','event/%');
      if(off.error){
        setBusy(b,false);
        await state.supabase.storage.from('posters').remove([path]);
        return toast(off.error.message,'error');
      }
    }

    const ins=await state.supabase.from('posters').insert({title:$('#posterTitle').value.trim(),storage_path:path,active:true});
    setBusy(b,false);
    if(ins.error){
      await state.supabase.storage.from('posters').remove([path]);
      return toast(ins.error.message,'error');
    }
    toast(category==='event'?'Poster Event berjaya dimuat naik dan dijadikan poster aktif.':'Poster berjaya dimuat naik. Landing page dikemas kini.','success');
    await loadPublic();
    await renderView('posters');
  });

  $$('.poster-toggle',root).forEach(b=>b.addEventListener('click',async()=>{
    const nextActive=b.dataset.active==='true';
    if(b.dataset.category==='event'&&nextActive){
      const off=await state.supabase.from('posters').update({active:false}).like('storage_path','event/%');
      if(off.error)return toast(off.error.message,'error');
    }
    const{error}=await state.supabase.from('posters').update({active:nextActive}).eq('id',b.dataset.id);
    if(error)return toast(error.message,'error');
    await loadPublic();
    renderView('posters');
  }));
}
