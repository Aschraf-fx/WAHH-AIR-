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
    const [{data:variants,error:ve},{data:recipes,error:re},{data:materials,error:me},{data:consumption,error:ce}]=await Promise.all([
      state.supabase.rpc('admin_variant_catalog'),
      state.supabase.rpc('admin_variant_recipe_list'),
      state.supabase.from('materials').select('id,name,unit,active').eq('active',true).order('name'),
      state.supabase.rpc('admin_event_variant_consumption_list',{p_limit:100})
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

    if(!ce){
      const rows=consumption||[];
      const history=document.createElement('section');
      history.className='panel';
      history.innerHTML=`
        <div class="panel-head"><div><h3>Event 100ml Consumption</h3><p>Ini bukti event yang sudah menolak stok sebenar. Variant 100ml bukan stok berasingan; bahan di bawah telah ditolak daripada Materials.</p></div></div>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Event</th><th>Tarikh Event</th><th>Status</th><th>Last Sync</th><th>Bahan Ditolak</th><th class="num">Qty</th><th class="num">Nilai</th></tr></thead><tbody>
          ${rows.length?rows.map(r=>`<tr><td><strong>${esc(r.event_name)}</strong><br><span class="muted">${num(r.event_quantity)} botol</span></td><td>${esc(r.event_date||'-')}</td><td>${esc(r.event_status||'-')}</td><td>${dateMY(r.synced_at)}</td><td>${esc(r.material_name)}</td><td class="num">${num(r.quantity,4)} ${esc(r.unit)}</td><td class="num">${money(r.amount)}</td></tr>`).join(''):tableEmpty(7,'Belum ada event 100ml yang sudah sync stok.')}
        </tbody></table></div>`;
      root.appendChild(history);
    }

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
    const catalog=data.catalog||[],items=data.items||[],autoUsage=data.auto_usage||[];
    if(!catalog.length) return;
    const selected=new Map(items.map(x=>[x.variant_id,Number(x.quantity||0)]));
    const eventQty=Number($('#edQty',root)?.value||0);
    const total=items.reduce((a,x)=>a+Number(x.quantity||0),0);
    const missing=catalog.filter(v=>Number(v.recipe_count||0)===0);
    const synced=Number(data.auto_usage_count||0)>0;
    const usedMissing=missing.filter(v=>(selected.get(v.variant_id)||0)>0);
    const recipeReady=items.length>0&&usedMissing.length===0;

    const section=document.createElement('section');
    section.className='panel';
    section.innerHTML=`
      <div class="panel-head"><div><h3>Product Mix Event • 100ml</h3><p>Pilih kuantiti setiap flavour. Jumlah mesti sama dengan ${num(eventQty)} botol event.</p></div></div>
      <div style="margin-bottom:14px;padding:14px;border:1px solid var(--border,#ddd);border-radius:12px">
        <div style="font-size:1.05rem;font-weight:700">${synced?'✅ STOK SUDAH DITOLAK':'🟠 BELUM TOLAK STOK'}</div>
        <div class="muted" style="margin-top:6px">Product Mix: ${num(total)} / ${num(eventQty)} botol • Recipe: ${recipeReady?'✅ COMPLETE':'⚠️ BELUM LENGKAP'}${synced&&data.synced_at?` • Last Sync: ${dateMY(data.synced_at)}`:''}</div>
      </div>
      <form id="eventVariantMixForm" class="form-stack">
        <div class="sale-lines">${catalog.map(v=>`<div class="sale-line event-variant-line" data-variant="${v.variant_id}"><div class="line-name"><strong>${esc(v.variant_name)}</strong><div class="price">${Number(v.recipe_count||0)>0?`${num(v.recipe_count)} komponen recipe`:'⚠️ Recipe belum diset'}</div></div><div><input class="event-variant-qty" type="number" min="0" step="1" value="${selected.get(v.variant_id)||0}"></div><div class="price">100ml</div></div>`).join('')}</div>
        <div class="row-actions"><button class="btn primary" type="submit">Simpan Product Mix</button><button class="btn success" type="button" id="eventVariantSync">${synced?'Re-sync Stok Ikut Recipe':'Sync & Tolak Stok Ikut Recipe'}</button></div>
      </form>
      ${synced?`<div class="table-wrap" style="margin-top:14px"><table class="data-table"><thead><tr><th>Bahan Ditolak</th><th class="num">Qty</th><th class="num">Unit Cost</th><th class="num">Nilai</th></tr></thead><tbody>${autoUsage.map(u=>`<tr><td><strong>${esc(u.material_name)}</strong></td><td class="num">${num(u.quantity,4)} ${esc(u.unit)}</td><td class="num">${money(u.unit_cost_snapshot)}</td><td class="num">${money(u.amount)}</td></tr>`).join('')}</tbody></table></div>`:''}`;

    const stockPanel=[...root.querySelectorAll('section.panel')].find(s=>s.querySelector('h3')?.textContent?.includes('Penggunaan Stok Untuk Event'));
    if(stockPanel) stockPanel.insertAdjacentElement('beforebegin',section); else root.appendChild(section);

    if(stockPanel){
      $$('.stock-remove',stockPanel).forEach(b=>{
        if((b.closest('tr')?.textContent||'').includes('Auto: recipe Product 100ml')){
          b.disabled=true;
          b.title='Stok auto-recipe diurus melalui Product Mix / Sync Recipe.';
        }
      });
    }

    $('#eventVariantMixForm',section).addEventListener('submit',async e=>{
      e.preventDefault();
      const lines=$$('.event-variant-line',section).map(line=>({variant_id:line.dataset.variant,quantity:Number($('.event-variant-qty',line).value||0)})).filter(x=>x.quantity>0);
      const sumQty=lines.reduce((a,x)=>a+x.quantity,0);
      if(sumQty!==eventQty)return toast(`Jumlah Product Mix mesti ${eventQty} botol. Sekarang ${sumQty}.`,'warning');
      const b=e.submitter;setBusy(b,true,'Menyimpan...');
      const{error}=await state.supabase.rpc('admin_set_event_variant_mix',{p_event_id:eventId,p_items:lines});
      setBusy(b,false);if(error)return toast(error.message,'error');toast('Product Mix 100ml disimpan. Jika sebelum ini stok sudah sync, stok lama telah dipulangkan dan perlu sync semula.','success');renderView('event-detail');
    });

    $('#eventVariantSync',section).addEventListener('click',async()=>{
      if(usedMissing.length)return toast('Ada flavour yang digunakan tetapi recipe 100ml belum diset. Lengkapkan di Bahan & Recipe dahulu.','warning');
      const ok=await confirmAction(synced?'Re-sync stok event?':'Sync stok event?',`Sistem akan kira penggunaan bahan daripada Product Mix ${eventQty} botol dan recipe 100ml, kemudian ${synced?'pulangkan kiraan lama dan tolak semula':'tolak'} stok bahan sebenar.`);if(!ok)return;
      const b=$('#eventVariantSync',section);setBusy(b,true,synced?'Re-sync stok...':'Sync stok...');
      const{error}=await state.supabase.rpc('admin_sync_event_variant_stock',{p_event_id:eventId});
      setBusy(b,false);if(error)return toast(error.message,'error');toast('Stok event berjaya disync ikut recipe 100ml.','success');renderView('event-detail');
    });
  }
})();
