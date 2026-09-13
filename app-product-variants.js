(function(){
  const oldRenderAdmin=window.renderAdmin;
  if(typeof oldRenderAdmin!=='function') return;

  window.renderAdmin=async function(view,root){
    const out=await oldRenderAdmin(view,root);
    try{
      if(view==='materials') await enhanceVariantRecipes(root);
      if(view==='event-detail' && state.eventSelectedId) await enhanceEventVariants(root,state.eventSelectedId);
    }catch(err){
      console.warn('Product variant enhancement unavailable:',err);
    }
    return out;
  };

  async function enhanceVariantRecipes(root){
    const [{data:variants,error:ve},{data:recipes,error:re},{data:materials,error:me}]=await Promise.all([
      state.supabase.rpc('admin_variant_catalog'),
      state.supabase.rpc('admin_variant_recipe_list'),
      state.supabase.from('materials').select('id,name,unit,active').eq('active',true).order('name')
    ]);
    if(ve||re||me) return;
    const eventVariants=(variants||[]).filter(v=>v.channel==='event'&&v.active);
    if(!eventVariants.length) return;

    const section=document.createElement('section');
    section.className='panel';
    section.innerHTML=`
      <div class="panel-head"><div><h3>Product Variant 100ml • Event</h3><p>Recipe 100ml guna stok bahan yang sama dalam Materials. Masukkan sukatan sebenar bagi 1 botol; sistem tidak mengagak sukatan.</p></div></div>
      <form id="variantRecipeForm" class="inline-form">
        <div class="field"><label>Produk 100ml</label><select id="vrVariant">${eventVariants.map(v=>`<option value="${v.variant_id}">${esc(v.variant_name)}</option>`).join('')}</select></div>
        <div class="field"><label>Bahan / stok bersama</label><select id="vrMaterial">${(materials||[]).map(m=>`<option value="${m.id}">${esc(m.name)} (${esc(m.unit)})</option>`).join('')}</select></div>
        <div class="field"><label>Qty / 1 botol 100ml</label><input id="vrQty" type="number" min="0.000001" step="0.000001" required></div>
        <button class="btn primary" type="submit">Simpan Recipe 100ml</button>
      </form>
      <div class="muted" style="margin-top:10px">Masukkan semua komponen yang memang digunakan — contohnya serbuk, susu dan botol 100ml jika komponen itu direkod sebagai material. Bahan yang sama boleh digunakan oleh produk lain tanpa membuat stok berasingan.</div>
      <div class="table-wrap" style="margin-top:14px"><table class="data-table"><thead><tr><th>Produk</th><th>Bahan</th><th class="num">Qty / botol</th><th></th></tr></thead><tbody>
        ${(recipes||[]).length?(recipes||[]).map(r=>`<tr><td><strong>${esc(r.variant_name)}</strong></td><td>${esc(r.material_name)}</td><td class="num">${num(r.qty_required,6)} ${esc(r.unit)}</td><td><button class="btn sm danger variant-recipe-delete" data-id="${r.recipe_id}">Delete</button></td></tr>`).join(''):tableEmpty(4,'Recipe 100ml belum diset.')}
      </tbody></table></div>`;
    root.appendChild(section);

    $('#variantRecipeForm',section).addEventListener('submit',async e=>{
      e.preventDefault();const b=e.submitter;setBusy(b,true,'Menyimpan...');
      const{error}=await state.supabase.rpc('admin_upsert_variant_recipe',{p_variant_id:$('#vrVariant',section).value,p_material_id:$('#vrMaterial',section).value,p_qty_required:Number($('#vrQty',section).value)});
      setBusy(b,false);if(error)return toast(error.message,'error');toast('Recipe 100ml dikemas kini.','success');renderView('materials');
    });
    $$('.variant-recipe-delete',section).forEach(b=>b.addEventListener('click',async()=>{
      const{error}=await state.supabase.rpc('admin_delete_variant_recipe',{p_recipe_id:b.dataset.id});
      if(error)return toast(error.message,'error');toast('Recipe 100ml dipadam.','success');renderView('materials');
    }));
  }

  async function enhanceEventVariants(root,eventId){
    const{data,error}=await state.supabase.rpc('admin_event_variant_state',{p_event_id:eventId});
    if(error||!data) return;
    const catalog=data.catalog||[],items=data.items||[];
    if(!catalog.length) return;
    const selected=new Map(items.map(x=>[x.variant_id,Number(x.quantity||0)]));
    const eventQty=Number($('#edQty',root)?.value||0);
    const total=items.reduce((a,x)=>a+Number(x.quantity||0),0);
    const missing=catalog.filter(v=>Number(v.recipe_count||0)===0);
    const synced=Number(data.auto_usage_count||0)>0;

    const section=document.createElement('section');
    section.className='panel';
    section.innerHTML=`
      <div class="panel-head"><div><h3>Product Mix Event • 100ml</h3><p>Pilih kuantiti setiap flavour. Jumlah mesti sama dengan ${num(eventQty)} botol event.</p></div></div>
      <form id="eventVariantMixForm" class="form-stack">
        <div class="sale-lines">${catalog.map(v=>`<div class="sale-line event-variant-line" data-variant="${v.variant_id}"><div class="line-name"><strong>${esc(v.variant_name)}</strong><div class="price">${Number(v.recipe_count||0)>0?`${num(v.recipe_count)} komponen recipe`:'⚠️ Recipe belum diset'}</div></div><div><input class="event-variant-qty" type="number" min="0" step="1" value="${selected.get(v.variant_id)||0}"></div><div class="price">100ml</div></div>`).join('')}</div>
        <div class="row-actions"><button class="btn primary" type="submit">Simpan Product Mix</button><button class="btn success" type="button" id="eventVariantSync">Sync & Tolak Stok Ikut Recipe</button></div>
        <div class="muted">Mix tersimpan: ${num(total)} / ${num(eventQty)} botol • Stok recipe: <strong>${synced?'SUDAH SYNC':'BELUM SYNC'}</strong>${missing.length?` • ${missing.length} produk masih tiada recipe`:''}</div>
      </form>`;

    const stockPanel=[...root.querySelectorAll('section.panel')].find(s=>s.querySelector('h3')?.textContent?.includes('Penggunaan Stok Untuk Event'));
    if(stockPanel) stockPanel.insertAdjacentElement('beforebegin',section); else root.appendChild(section);

    $('#eventVariantMixForm',section).addEventListener('submit',async e=>{
      e.preventDefault();
      const lines=$$('.event-variant-line',section).map(line=>({variant_id:line.dataset.variant,quantity:Number($('.event-variant-qty',line).value||0)})).filter(x=>x.quantity>0);
      const sumQty=lines.reduce((a,x)=>a+x.quantity,0);
      if(sumQty!==eventQty)return toast(`Jumlah Product Mix mesti ${eventQty} botol. Sekarang ${sumQty}.`,'warning');
      const b=e.submitter;setBusy(b,true,'Menyimpan...');
      const{error}=await state.supabase.rpc('admin_set_event_variant_mix',{p_event_id:eventId,p_items:lines});
      setBusy(b,false);if(error)return toast(error.message,'error');toast('Product Mix 100ml disimpan. Jika sebelum ini stok sudah sync, ia telah dipulangkan dan perlu sync semula.','success');renderView('event-detail');
    });

    $('#eventVariantSync',section).addEventListener('click',async()=>{
      if(missing.some(v=>(selected.get(v.variant_id)||0)>0))return toast('Ada flavour yang digunakan tetapi recipe 100ml belum diset. Lengkapkan di Bahan & Recipe dahulu.','warning');
      const ok=await confirmAction('Sync stok event?',`Sistem akan kira penggunaan bahan daripada Product Mix ${eventQty} botol dan recipe 100ml, kemudian tolak stok bahan sebenar.`);if(!ok)return;
      const b=$('#eventVariantSync',section);setBusy(b,true,'Sync stok...');
      const{error}=await state.supabase.rpc('admin_sync_event_variant_stock',{p_event_id:eventId});
      setBusy(b,false);if(error)return toast(error.message,'error');toast('Stok event berjaya disync ikut recipe 100ml.','success');renderView('event-detail');
    });
  }
})();
