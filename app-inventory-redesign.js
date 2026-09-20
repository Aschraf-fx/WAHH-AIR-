(function(){
  const INVENTORY_VIEW='stock';

  const previousRenderAdmin=window.renderAdmin;
  if(typeof previousRenderAdmin!=='function') return;

  window.renderAdmin=async function(view,root){
    if(view===INVENTORY_VIEW) return renderInventory(root);
    return previousRenderAdmin(view,root);
  };

  function sum(rows,key='quantity'){
    return (rows||[]).reduce((total,row)=>total+Number(row[key]||0),0);
  }

  function byName(rows){
    const map=new Map();
    (rows||[]).forEach(row=>map.set(row.flavour_name,row));
    return map;
  }

  function hqRows(stock){
    return (stock||[]).filter(row=>row.location_code==='WAHH-HQ');
  }

  function teamRows(stock){
    return (stock||[]).filter(row=>row.location_code!=='WAHH-HQ');
  }

  function getActiveTab(){
    return state.inventoryTab||'overview';
  }

  function setActiveTab(tab){
    state.inventoryTab=tab;
  }

  async function renderInventory(root){
    const [{data:stock,error:stockError},{data:members,error:membersError},{data:flavours,error:flavourError},{data:materials,error:materialsError}]=await Promise.all([
      state.supabase.rpc('admin_stock_summary'),
      state.supabase.rpc('admin_list_members'),
      state.supabase.from('flavours').select('id,name,low_stock_threshold,active').eq('active',true).order('created_at'),
      state.supabase.from('materials').select('id,name,unit,current_qty,avg_unit_cost,min_qty,active').eq('active',true).order('name')
    ]);
    if(stockError) throw stockError;
    if(membersError) throw membersError;
    if(flavourError) throw flavourError;
    if(materialsError) throw materialsError;

    const activeMembers=(members||[]).filter(x=>x.status==='active');
    const hq=hqRows(stock);
    const team=teamRows(stock);
    const hqMap=byName(hq);
    const teamByFlavour=new Map();

    team.forEach(row=>{
      teamByFlavour.set(row.flavour_name,(teamByFlavour.get(row.flavour_name)||0)+Number(row.quantity||0));
    });

    const hqTotal=sum(hq);
    const teamTotal=sum(team);
    const lowCount=(flavours||[]).filter(f=>Number(hqMap.get(f.name)?.quantity||0)<=Number(f.low_stock_threshold||0)).length;
    const tabs=[
      ['overview','Stok Siap'],
      ['materials','Bahan Mentah'],
      ['produce','Tambah Stok Siap'],
      ['allocate','Agih Stok'],
      ['return','Pulangkan'],
      ['adjust','Correction']
    ];

    root.innerHTML=pageHead('INVENTORY','Inventory WAHH AIR','Semak stok, tambah pengeluaran dan pindahkan stok tanpa campur semua kerja dalam satu skrin.')+
      `<div class="inv-shell">
        <section class="inv-summary" aria-label="Ringkasan inventori">
          <div class="inv-summary-main">
            <span>Stok HQ</span>
            <strong>${num(hqTotal)}</strong>
            <small>botol tersedia untuk operasi</small>
          </div>
          <dl class="inv-summary-list">
            <div><dt>Dengan Rider / Ejen</dt><dd>${num(teamTotal)}</dd></div>
            <div><dt>Jumlah Dalam Sistem</dt><dd>${num(hqTotal+teamTotal)}</dd></div>
            <div><dt>Flavour Low Stock</dt><dd class="${lowCount?'inv-danger':''}">${num(lowCount)}</dd></div>
            <div><dt>Member Aktif</dt><dd>${num(activeMembers.length)}</dd></div>
          </dl>
        </section>

        <nav class="inv-tabs" aria-label="Bahagian inventory">
          ${tabs.map(([id,label])=>`<button type="button" class="inv-tab ${getActiveTab()===id?'active':''}" data-inv-tab="${id}">${label}</button>`).join('')}
        </nav>

        <div id="inventoryWorkspace"></div>
      </div>`;

    $$('.inv-tab',root).forEach(btn=>btn.addEventListener('click',()=>{
      setActiveTab(btn.dataset.invTab);
      renderInventory(root);
    }));

    renderWorkspace($('#inventoryWorkspace',root),getActiveTab(),{stock,flavours,materials:materials||[],activeMembers,hqMap,teamByFlavour,hqTotal,teamTotal});
  }

  function renderWorkspace(host,tab,ctx){
    if(tab==='materials') return renderMaterials(host,ctx);
    if(tab==='produce') return renderProduce(host,ctx);
    if(tab==='allocate') return renderAllocate(host,ctx);
    if(tab==='return') return renderReturn(host,ctx);
    if(tab==='adjust') return renderAdjustment(host,ctx);
    return renderOverview(host,ctx);
  }

  function renderOverview(host,{stock,flavours,hqMap,teamByFlavour}){
    const rows=(flavours||[]).map(f=>{
      const hqQty=Number(hqMap.get(f.name)?.quantity||0);
      const teamQty=Number(teamByFlavour.get(f.name)||0);
      const low=hqQty<=Number(f.low_stock_threshold||0);
      return `<tr>
        <td><strong>${esc(f.name)}</strong></td>
        <td class="num"><strong>${num(hqQty)}</strong></td>
        <td class="num">${num(teamQty)}</td>
        <td class="num">${num(hqQty+teamQty)}</td>
        <td><span class="inv-stock-state ${low?'low':'ok'}">${low?'Low stock':'OK'}</span></td>
      </tr>`;
    }).join('');

    host.innerHTML=`
      <section class="inv-section">
        <div class="inv-section-head">
          <div><h2>Stok Mengikut Flavour</h2><p>HQ ialah stok yang boleh diagih. Stok Rider/Ejen masih berada dalam sistem tetapi bukan lagi di HQ.</p></div>
        </div>
        <div class="table-wrap inv-table-wrap">
          <table class="data-table inv-table">
            <thead><tr><th>Flavour</th><th class="num">HQ</th><th class="num">Rider / Ejen</th><th class="num">Jumlah</th><th>Status HQ</th></tr></thead>
            <tbody>${rows||tableEmpty(5,'Tiada flavour aktif.')}</tbody>
          </table>
        </div>
      </section>

      <section class="inv-section inv-locations">
        <div class="inv-section-head inv-section-head-tools">
          <div><h2>Lokasi Stok</h2><p>Cari lokasi atau flavour tanpa menukar data.</p></div>
          <label class="inv-search">Cari<input id="invStockSearch" type="search" placeholder="Rider, lokasi atau flavour"></label>
        </div>
        <div class="table-wrap inv-table-wrap">
          <table class="data-table inv-table">
            <thead><tr><th>Lokasi</th><th>Nama</th><th>Flavour</th><th class="num">Qty</th></tr></thead>
            <tbody id="invLocationRows"></tbody>
          </table>
        </div>
      </section>`;

    const renderRows=()=>{
      const q=$('#invStockSearch',host).value.trim().toLowerCase();
      const filtered=(stock||[]).filter(r=>!q||[r.location_code,r.location_name,r.flavour_name].some(v=>String(v||'').toLowerCase().includes(q)));
      $('#invLocationRows',host).innerHTML=filtered.length?filtered.map(r=>`<tr>
        <td><strong>${esc(r.location_code)}</strong></td>
        <td>${esc(r.location_name)}</td>
        <td>${esc(r.flavour_name)}</td>
        <td class="num">${num(r.quantity)}</td>
      </tr>`).join(''):tableEmpty(4,'Tiada stok sepadan.');
    };
    renderRows();
    $('#invStockSearch',host).addEventListener('input',renderRows);
  }

  function renderMaterials(host,{materials}){
    const rows=(materials||[]).map(m=>`<tr>
      <td><strong>${esc(m.name)}</strong><div class="muted">${esc(m.unit)}</div></td>
      <td class="num"><strong>${num(m.current_qty,4)}</strong></td>
      <td class="num">${money(m.avg_unit_cost)} / ${esc(m.unit)}</td>
      <td class="num">${money(Number(m.current_qty||0)*Number(m.avg_unit_cost||0))}</td>
      <td><button class="btn sm ghost inv-material-set" type="button" data-id="${m.id}" data-name="${esc(m.name)}" data-unit="${esc(m.unit)}" data-qty="${m.current_qty}">Edit baki</button></td>
    </tr>`).join('');

    host.innerHTML=`
      <section class="inv-section inv-action-section">
        <div class="inv-section-head">
          <div><h2>Tambah Bahan Mentah</h2><p>Pilih bahan yang memang sudah wujud. Masukkan berapa banyak dibeli dan jumlah harga resit; sistem kira harga per unit sendiri.</p></div>
        </div>
        <form id="invMaterialPurchaseForm" class="inv-form-grid">
          <label class="inv-span-2">Bahan<select id="invMatId" required>${(materials||[]).map(m=>`<option value="${m.id}" data-unit="${esc(m.unit)}" data-current="${m.current_qty}">${esc(m.name)} — baki ${num(m.current_qty,4)} ${esc(m.unit)}</option>`).join('')}</select></label>
          <label>Quantity ditambah<input id="invMatQty" type="number" min="0.0001" step="0.0001" inputmode="decimal" required placeholder="Contoh: 560"></label>
          <label>Harga belian keseluruhan (RM)<input id="invMatTotalCost" type="number" min="0" step="0.01" inputmode="decimal" required placeholder="Contoh: 30.00"></label>
          <label class="inv-span-2">Supplier<input id="invMatSupplier" maxlength="120" placeholder="Optional"></label>
          <div class="inv-form-status inv-span-2" id="invMatCalc">Masukkan quantity dan harga belian.</div>
          <div class="inv-form-actions inv-span-2"><button class="btn primary" type="submit">Tambah Ke Baki Bahan</button></div>
        </form>
      </section>

      <section class="inv-section">
        <div class="inv-section-head"><div><h2>Baki Bahan Semasa</h2><p>Edit baki hanya untuk samakan sistem dengan kiraan fizikal sebenar. Ia tidak merekod pembelian baru.</p></div></div>
        <div class="table-wrap inv-table-wrap">
          <table class="data-table inv-table">
            <thead><tr><th>Bahan</th><th class="num">Baki</th><th class="num">Kos Purata</th><th class="num">Nilai Stok</th><th></th></tr></thead>
            <tbody>${rows||tableEmpty(5,'Belum ada bahan.')}</tbody>
          </table>
        </div>
      </section>`;

    const calc=()=>{
      const sel=$('#invMatId',host);
      const opt=sel.options[sel.selectedIndex];
      const unit=opt?.dataset.unit||'unit';
      const current=Number(opt?.dataset.current||0);
      const qty=Number($('#invMatQty',host).value||0);
      const total=Number($('#invMatTotalCost',host).value||0);
      const unitCost=qty>0?total/qty:0;
      $('#invMatCalc',host).innerHTML=qty>0
        ? `Baki ${num(current,4)} ${esc(unit)} + ${num(qty,4)} ${esc(unit)} = <strong>${num(current+qty,4)} ${esc(unit)}</strong> • Kos pembelian ini <strong>${money(unitCost)} / ${esc(unit)}</strong>`
        : 'Masukkan quantity dan harga belian.';
    };
    $('#invMatId',host).addEventListener('change',calc);
    $('#invMatQty',host).addEventListener('input',calc);
    $('#invMatTotalCost',host).addEventListener('input',calc);

    $('#invMaterialPurchaseForm',host).addEventListener('submit',async e=>{
      e.preventDefault();
      const qty=Number($('#invMatQty',host).value||0);
      const total=Number($('#invMatTotalCost',host).value||0);
      if(!(qty>0)||total<0) return toast('Semak quantity dan harga belian.','warning');
      const sel=$('#invMatId',host);
      const opt=sel.options[sel.selectedIndex];
      const current=Number(opt?.dataset.current||0);
      const unit=opt?.dataset.unit||'unit';
      const ok=await confirmAction('Tambah bahan mentah?',`${opt?.textContent?.split(' — ')[0]||'Bahan'}: ${num(qty,4)} ${unit}, harga resit ${money(total)}. Baki akan jadi ${num(current+qty,4)} ${unit}.`);
      if(!ok) return;
      const btn=e.submitter;
      setBusy(btn,true,'Menambah bahan...');
      const {error}=await state.supabase.rpc('admin_record_material_purchase_total',{
        p_material_id:sel.value,
        p_quantity:qty,
        p_total_cost:total,
        p_supplier:$('#invMatSupplier',host).value.trim()||null,
        p_notes:'Inventory restock'
      });
      setBusy(btn,false);
      if(error) return toast(error.message,'error');
      toast('Bahan ditambah dan kos per unit dikira automatik.','success');
      renderView('stock');
    });

    $('.inv-material-set',host).forEach(btn=>btn.addEventListener('click',async()=>{
      const next=window.prompt(`Baki sebenar ${btn.dataset.name} (${btn.dataset.unit}):`,btn.dataset.qty);
      if(next===null) return;
      const qty=Number(next);
      if(!Number.isFinite(qty)||qty<0) return toast('Baki stok tidak sah.','warning');
      const reason=window.prompt('Sebab edit baki stok:','Kiraan stok fizikal');
      if(reason===null) return;
      const ok=await confirmAction('Edit baki bahan?',`${btn.dataset.name}: ${num(Number(btn.dataset.qty),4)} → ${num(qty,4)} ${btn.dataset.unit}.`);
      if(!ok) return;
      const {error}=await state.supabase.rpc('admin_set_material_quantity',{p_material_id:btn.dataset.id,p_new_quantity:qty,p_reason:reason.trim()||null});
      if(error) return toast(error.message,'error');
      toast('Baki bahan dikemas kini.','success');
      renderView('stock');
    }));
  }

  function flavourOptions(flavours,selected=''){
    return (flavours||[]).map(f=>`<option value="${f.id}" ${String(f.id)===String(selected)?'selected':''}>${esc(f.name)}</option>`).join('');
  }

  function memberOptions(members){
    return (members||[]).map(m=>`<option value="${esc(m.public_id)}">${esc(m.public_id)} — ${esc(m.full_name)}</option>`).join('');
  }

  function renderProduce(host,{flavours,hqMap}){
    host.innerHTML=`
      <section class="inv-section inv-action-section">
        <div class="inv-section-head"><div><h2>Tambah Stok Siap</h2><p>Gunakan ini selepas produk siap dibuat. Recipe akan menolak bahan mentah secara automatik.</p></div></div>
        <form id="invProduceForm" class="inv-form-grid">
          <label>Flavour<select id="invProdFlavour" required>${flavourOptions(flavours)}</select></label>
          <label>Qty siap<input id="invProdQty" type="number" min="1" step="1" inputmode="numeric" required placeholder="Contoh: 50"></label>
          <label class="inv-span-2">Nota<input id="invProdReason" value="Production" maxlength="120"></label>
          <div class="inv-form-status inv-span-2" id="invProduceStatus"></div>
          <div class="inv-form-actions inv-span-2"><button class="btn primary" type="submit">Tambah Ke Stok HQ</button></div>
        </form>
      </section>`;

    const update=()=>{
      const flavour=(flavours||[]).find(f=>String(f.id)===$('#invProdFlavour',host).value);
      const current=Number(hqMap.get(flavour?.name)?.quantity||0);
      const qty=Number($('#invProdQty',host).value||0);
      $('#invProduceStatus',host).textContent=flavour?`Stok HQ sekarang: ${num(current)} • Selepas tambah: ${num(current+Math.max(qty,0))}`:'';
    };
    $('#invProdFlavour',host).addEventListener('change',update);
    $('#invProdQty',host).addEventListener('input',update);
    update();

    $('#invProduceForm',host).addEventListener('submit',async e=>{
      e.preventDefault();
      const btn=e.submitter;
      setBusy(btn,true,'Menambah stok...');
      const {error}=await state.supabase.rpc('admin_produce_stock',{
        p_flavour_id:$('#invProdFlavour',host).value,
        p_quantity:Number($('#invProdQty',host).value),
        p_reason:$('#invProdReason',host).value.trim()||'Production'
      });
      setBusy(btn,false);
      if(error) return toast(error.message,'error');
      toast('Stok siap ditambah ke HQ.','success');
      renderView('stock');
    });
  }

  function renderAllocate(host,{flavours,activeMembers,hqMap}){
    const available=new Map((flavours||[]).map(f=>[String(f.id),Number(hqMap.get(f.name)?.quantity||0)]));
    host.innerHTML=`
      <section class="inv-section inv-action-section">
        <div class="inv-section-head"><div><h2>Agih Stok Kepada Rider / Ejen</h2><p>Pilih penerima sekali. Tambah semua flavour yang mahu dihantar, kemudian sahkan satu kali.</p></div></div>
        <form id="invAllocateForm">
          <div class="inv-form-grid inv-alloc-member">
            <label class="inv-span-2">Rider / Ejen<select id="invAllocMember" required><option value="">Pilih penerima...</option>${memberOptions(activeMembers)}</select></label>
          </div>
          <div class="inv-alloc-list-head"><span>Flavour</span><span>Qty</span><span></span></div>
          <div id="invAllocRows" class="inv-alloc-list"></div>
          <div class="inv-alloc-footer">
            <button class="btn ghost" id="invAddFlavour" type="button">＋ Tambah Flavour</button>
            <div class="inv-allocation-total"><span>Jumlah diagih</span><strong id="invAllocationTotal">0 botol</strong></div>
          </div>
          <div id="invAllocateError" class="inv-inline-error" role="alert"></div>
          <div class="inv-form-actions"><button class="btn primary" type="submit">Allocate Semua</button></div>
        </form>
      </section>`;

    const rowsHost=$('#invAllocRows',host);
    const options=(selected='')=>(flavours||[]).map(f=>{
      const qty=available.get(String(f.id))||0;
      return `<option value="${f.id}" ${String(f.id)===String(selected)?'selected':''}>${esc(f.name)} — HQ ${num(qty)}</option>`;
    }).join('');

    const validate=()=>{
      const rows=$$('.inv-alloc-row',rowsHost);
      let total=0;
      const seen=new Set();
      let message='';
      rows.forEach(row=>{
        const id=$('.inv-alloc-flavour',row).value;
        const qty=Number($('.inv-alloc-qty',row).value||0);
        total+=Math.max(qty,0);
        row.classList.remove('has-error');
        if(seen.has(id)){
          message='Flavour yang sama tidak boleh dimasukkan dua kali.';
          row.classList.add('has-error');
        }
        seen.add(id);
        if(qty>Number(available.get(id)||0)){
          message='Ada kuantiti yang melebihi stok HQ.';
          row.classList.add('has-error');
        }
      });
      $('#invAllocationTotal',host).textContent=`${num(total)} botol`;
      $('#invAllocateError',host).textContent=message;
      return !message;
    };

    const addRow=(selected='')=>{
      const row=document.createElement('div');
      row.className='inv-alloc-row';
      row.innerHTML=`
        <label><span class="inv-mobile-label">Flavour</span><select class="inv-alloc-flavour" required>${options(selected)}</select></label>
        <label><span class="inv-mobile-label">Qty</span><input class="inv-alloc-qty" type="number" min="1" step="1" inputmode="numeric" required placeholder="0"></label>
        <button class="inv-remove-row" type="button" aria-label="Buang flavour">Buang</button>`;
      $('.inv-remove-row',row).addEventListener('click',()=>{
        if($$('.inv-alloc-row',rowsHost).length===1) return toast('Sekurang-kurangnya satu flavour diperlukan.','warning');
        row.remove();
        validate();
      });
      $('.inv-alloc-flavour',row).addEventListener('change',validate);
      $('.inv-alloc-qty',row).addEventListener('input',validate);
      rowsHost.appendChild(row);
      validate();
    };

    addRow(flavours?.[0]?.id||'');

    $('#invAddFlavour',host).addEventListener('click',()=>{
      const chosen=new Set($$('.inv-alloc-flavour',rowsHost).map(el=>el.value));
      const next=(flavours||[]).find(f=>!chosen.has(String(f.id)));
      if(!next) return toast('Semua flavour aktif sudah ditambah.','warning');
      addRow(next.id);
    });

    $('#invAllocateForm',host).addEventListener('submit',async e=>{
      e.preventDefault();
      const publicId=$('#invAllocMember',host).value;
      if(!publicId) return toast('Pilih Rider/Ejen dahulu.','warning');
      if(!validate()) return;
      const items=$$('.inv-alloc-row',rowsHost).map(row=>({
        flavour_id:$('.inv-alloc-flavour',row).value,
        quantity:Number($('.inv-alloc-qty',row).value||0)
      }));
      if(items.some(x=>!Number.isInteger(x.quantity)||x.quantity<1)) return toast('Masukkan kuantiti sekurang-kurangnya 1 untuk setiap flavour.','warning');
      const total=items.reduce((a,x)=>a+x.quantity,0);
      const member=activeMembers.find(m=>m.public_id===publicId);
      const ok=await confirmAction('Allocate stok?',`${items.length} flavour • ${total} botol akan dihantar kepada ${member?.full_name||publicId} (${publicId}).`);
      if(!ok) return;
      const btn=e.submitter;
      setBusy(btn,true,'Mengagih stok...');
      const {error}=await state.supabase.rpc('admin_allocate_stock_bulk',{p_public_id:publicId,p_items:items});
      setBusy(btn,false);
      if(error) return toast(error.message,'error');
      toast(`${total} botol berjaya diagihkan kepada ${publicId}.`,'success');
      renderView('stock');
    });
  }

  function renderReturn(host,{flavours,activeMembers}){
    host.innerHTML=`
      <section class="inv-section inv-action-section">
        <div class="inv-section-head"><div><h2>Pulangkan Stok Ke HQ</h2><p>Pilih member dahulu. Sistem akan tunjuk baki stok mereka supaya kuantiti tidak diteka.</p></div></div>
        <form id="invReturnForm" class="inv-form-grid">
          <label class="inv-span-2">Rider / Ejen<select id="invReturnMember" required><option value="">Pilih member...</option>${memberOptions(activeMembers)}</select></label>
          <label>Flavour<select id="invReturnFlavour" required disabled><option value="">Pilih member dahulu</option></select></label>
          <label>Qty dipulangkan<input id="invReturnQty" type="number" min="1" step="1" inputmode="numeric" required disabled></label>
          <div id="invReturnStatus" class="inv-form-status inv-span-2">Pilih member untuk semak stok semasa.</div>
          <div class="inv-form-actions inv-span-2"><button class="btn primary" type="submit">Pulangkan Ke HQ</button></div>
        </form>
      </section>`;

    let memberStock=[];
    const refreshStatus=()=>{
      const id=$('#invReturnFlavour',host).value;
      const row=memberStock.find(x=>String(x.flavour_id)===String(id));
      $('#invReturnStatus',host).textContent=row?`Baki member: ${num(row.quantity)} botol ${row.flavour_name}`:'Pilih flavour.';
      if(row) $('#invReturnQty',host).max=String(row.quantity);
    };

    $('#invReturnMember',host).addEventListener('change',async()=>{
      const pid=$('#invReturnMember',host).value;
      const flavourSelect=$('#invReturnFlavour',host);
      const qtyInput=$('#invReturnQty',host);
      if(!pid){
        flavourSelect.disabled=true;
        qtyInput.disabled=true;
        return;
      }
      $('#invReturnStatus',host).textContent='Memuatkan stok member...';
      const {data,error}=await state.supabase.rpc('admin_get_member_stock',{p_public_id:pid});
      if(error){
        $('#invReturnStatus',host).textContent=error.message;
        return;
      }
      memberStock=(data||[]).filter(x=>Number(x.quantity)>0);
      flavourSelect.innerHTML=memberStock.length?memberStock.map(x=>`<option value="${x.flavour_id}">${esc(x.flavour_name)} — ${num(x.quantity)} botol</option>`).join(''):'<option value="">Tiada stok</option>';
      flavourSelect.disabled=!memberStock.length;
      qtyInput.disabled=!memberStock.length;
      qtyInput.value='';
      refreshStatus();
    });
    $('#invReturnFlavour',host).addEventListener('change',refreshStatus);

    $('#invReturnForm',host).addEventListener('submit',async e=>{
      e.preventDefault();
      const pid=$('#invReturnMember',host).value;
      const flavourId=$('#invReturnFlavour',host).value;
      const qty=Number($('#invReturnQty',host).value||0);
      const row=memberStock.find(x=>String(x.flavour_id)===String(flavourId));
      if(!row||qty<1||qty>Number(row.quantity)) return toast('Semak kuantiti stok member.','warning');
      const ok=await confirmAction('Pulangkan stok?',`${qty} botol ${row.flavour_name} akan dipindahkan daripada ${pid} kembali ke HQ.`);
      if(!ok) return;
      const btn=e.submitter;
      setBusy(btn,true,'Memulangkan...');
      const {error}=await state.supabase.rpc('admin_return_stock',{p_public_id:pid,p_flavour_id:flavourId,p_quantity:qty});
      setBusy(btn,false);
      if(error) return toast(error.message,'error');
      toast('Stok berjaya dipulangkan ke HQ.','success');
      renderView('stock');
    });
  }

  function renderAdjustment(host,{flavours,hqMap}){
    host.innerHTML=`
      <section class="inv-section inv-action-section inv-correction">
        <div class="inv-section-head"><div><h2>Stock Correction HQ</h2><p>Untuk stock count, stok siap dibeli dari luar atau pembetulan rekod. Nilai positif tambah, nilai negatif tolak.</p></div></div>
        <form id="invAdjustForm" class="inv-form-grid">
          <label>Flavour<select id="invAdjustFlavour" required>${flavourOptions(flavours)}</select></label>
          <label>Perubahan qty<input id="invAdjustQty" type="number" step="1" inputmode="numeric" required placeholder="+10 atau -5"></label>
          <label class="inv-span-2">Sebab correction<input id="invAdjustReason" required maxlength="160" placeholder="Contoh: kiraan stok fizikal"></label>
          <div id="invAdjustStatus" class="inv-form-status inv-span-2"></div>
          <div class="inv-form-actions inv-span-2"><button class="btn danger" type="submit">Sahkan Correction</button></div>
        </form>
      </section>`;

    const update=()=>{
      const flavour=(flavours||[]).find(f=>String(f.id)===$('#invAdjustFlavour',host).value);
      const current=Number(hqMap.get(flavour?.name)?.quantity||0);
      const change=Number($('#invAdjustQty',host).value||0);
      const after=current+change;
      $('#invAdjustStatus',host).innerHTML=flavour?`Stok sekarang <strong>${num(current)}</strong> → selepas correction <strong class="${after<0?'inv-danger':''}">${num(after)}</strong>`:'';
    };
    $('#invAdjustFlavour',host).addEventListener('change',update);
    $('#invAdjustQty',host).addEventListener('input',update);
    update();

    $('#invAdjustForm',host).addEventListener('submit',async e=>{
      e.preventDefault();
      const qty=Number($('#invAdjustQty',host).value||0);
      if(!Number.isInteger(qty)||qty===0) return toast('Perubahan qty mesti nombor bulat dan bukan 0.','warning');
      const flavour=(flavours||[]).find(f=>String(f.id)===$('#invAdjustFlavour',host).value);
      const current=Number(hqMap.get(flavour?.name)?.quantity||0);
      if(current+qty<0) return toast('Correction ini akan menjadikan stok HQ negatif.','warning');
      const ok=await confirmAction('Sahkan stock correction?',`${flavour?.name||'Flavour'}: ${qty>0?'+':''}${qty} botol. Sebab: ${$('#invAdjustReason',host).value.trim()}`);
      if(!ok) return;
      const btn=e.submitter;
      setBusy(btn,true,'Mengemas kini...');
      const {error}=await state.supabase.rpc('admin_adjust_hq_stock',{
        p_flavour_id:$('#invAdjustFlavour',host).value,
        p_quantity_change:qty,
        p_reason:$('#invAdjustReason',host).value.trim()
      });
      setBusy(btn,false);
      if(error) return toast(error.message,'error');
      toast('Stok HQ dikemas kini.','success');
      renderView('stock');
    });
  }
})();