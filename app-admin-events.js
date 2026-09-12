(function(){
  const statusLabel={pending:'Pending',confirmed:'Confirmed',completed:'Completed',cancelled:'Cancelled'};
  const costLabel={beverage_material:'Bahan minuman',bottle:'Botol',ice:'Ais',cooler_box:'Kotak gabus',delivery:'Kos penghantaran',packaging:'Packaging tambahan',other:'Kos lain'};

  function defaultPrice(qty){
    qty=Number(qty||0);
    if(qty>=600)return 3.30;
    if(qty>=400)return 3.60;
    if(qty>=200)return 4.00;
    return 4.00;
  }
  function isoLocal(v){ if(!v)return ''; const d=new Date(v); const z=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; }
  function sum(rows,key='amount'){return (rows||[]).reduce((a,x)=>a+Number(x[key]||0),0);}
  function fmtStatus(v){return statusLabel[v]||v||'-';}

  const oldBuildMenu=window.buildMenu;
  window.buildMenu=function(){
    oldBuildMenu();
    if(state.profile?.role!=='admin')return;
    const menu=$('#sideMenu');
    if(menu&&!menu.querySelector('[data-view="events"]')){
      const btn=document.createElement('button');
      btn.dataset.view='events';
      btn.innerHTML='<span>✦</span>Pengurusan Event';
      menu.appendChild(btn);
    }
  };

  const oldRenderAdmin=window.renderAdmin;
  window.renderAdmin=async function(view,root){
    if(view==='events')return adminEvents(root);
    if(view==='event-detail')return adminEventDetail(root,state.eventSelectedId);
    return oldRenderAdmin(view,root);
  };

  async function adminEvents(root){
    const search=state.eventFilters?.search||'';
    const start=state.eventFilters?.start||'';
    const end=state.eventFilters?.end||'';
    const status=state.eventFilters?.status||'';
    const {data,error}=await state.supabase.rpc('admin_event_list',{p_search:search||null,p_start:start||null,p_end:end||null,p_status:status||null});
    if(error)throw error;
    const rows=data||[];
    const totalIncome=sum(rows,'total_income'),received=sum(rows,'received'),balance=sum(rows,'balance_due'),cost=sum(rows,'total_cost'),comm=sum(rows,'total_commission'),profit=sum(rows,'net_profit');

    root.innerHTML=pageHead('ADMIN • EVENT','Pengurusan Event WAHH AIR','Tempahan Event/Wedding 100ml, kutipan, kos, komisen dan pembahagian keuntungan. Data ini admin sahaja.')+`
      <div class="kpi-grid">
        ${kpi('Jumlah Event',num(rows.length))}
        ${kpi('Jumlah Pendapatan',money(totalIncome))}
        ${kpi('Bayaran Diterima',money(received))}
        ${kpi('Baki Pelanggan',money(balance))}
        ${kpi('Kos Event',money(cost))}
        ${kpi('Komisen / Upah',money(comm))}
        ${kpi(profit>=0?'Untung Bersih':'Kerugian',`<span class="${profit>=0?'profit-positive':'profit-negative'}">${money(profit)}</span>`)}
      </div>

      <section class="panel">
        <div class="panel-head"><div><h3>Tambah Tempahan Event</h3><p>Harga lalai berubah ikut kuantiti tetapi boleh diubah untuk harga khas. Minimum 200 botol.</p></div></div>
        <form id="eventCreateForm" class="form-stack">
          <div class="grid-2">
            <label>Nama event / majlis<input id="evName" required placeholder="Contoh: Wedding Amir & Sarah"></label>
            <label>Nama pelanggan<input id="evCustomer" required></label>
            <label>No. telefon<input id="evPhone" type="tel"></label>
            <label>Tarikh event<input id="evDate" type="date" required value="${todayISO()}"></label>
            <label>Lokasi<input id="evLocation"></label>
            <label>Kuantiti botol<input id="evQty" type="number" min="200" step="1" required value="200"></label>
            <label>Harga jual / botol (RM)<input id="evPrice" type="number" min="0" step="0.01" required value="4.00"></label>
            <label>Caj penghantaran kepada pelanggan (RM)<input id="evDeliveryIncome" type="number" min="0" step="0.01" value="0"></label>
            <label>Status<select id="evStatus"><option value="pending">Pending</option><option value="confirmed">Confirmed</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select></label>
            <label>Kaedah kos bahan/botol<select id="evCostMode"><option value="combined">Gabungan bahan + botol</option><option value="itemized">Pecahan satu-satu</option></select></label>
            <label>Kos gabungan / botol (RM)<input id="evBaseCost" type="number" min="0" step="0.0001" value="0.74"></label>
          </div>
          <label>Catatan<textarea id="evNotes" rows="3"></textarea></label>
          <div class="muted">Jika guna kos gabungan RM0.74/botol, sistem tidak benarkan tambah kos “Bahan minuman” atau “Botol” sekali lagi untuk elak kiraan berganda.</div>
          <button class="btn primary" type="submit">Simpan Tempahan Event</button>
        </form>
      </section>

      <section class="panel">
        <div class="panel-head"><div><h3>Senarai Event</h3><p>Carian dan ringkasan mengikut rekod yang ditapis.</p></div></div>
        <form id="eventFilterForm" class="inline-form">
          <div class="field"><label>Cari event / pelanggan</label><input id="eventSearch" value="${esc(search)}"></div>
          <div class="field"><label>Dari</label><input id="eventStart" type="date" value="${esc(start)}"></div>
          <div class="field"><label>Hingga</label><input id="eventEnd" type="date" value="${esc(end)}"></div>
          <div class="field"><label>Status</label><select id="eventStatus"><option value="">Semua</option>${Object.entries(statusLabel).map(([v,l])=>`<option value="${v}" ${status===v?'selected':''}>${l}</option>`).join('')}</select></div>
          <button class="btn ghost" type="submit">Tapis</button>
        </form>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Event</th><th>Pelanggan</th><th>Tarikh</th><th>Status</th><th class="num">Botol</th><th class="num">Pendapatan</th><th class="num">Diterima</th><th class="num">Baki</th><th class="num">Untung</th><th></th></tr></thead><tbody>
          ${rows.length?rows.map(r=>`<tr><td><strong>${esc(r.event_name)}</strong></td><td>${esc(r.customer_name)}</td><td>${esc(r.event_date)}</td><td>${esc(fmtStatus(r.status))}</td><td class="num">${num(r.quantity)}</td><td class="num">${money(r.total_income)}</td><td class="num">${money(r.received)}</td><td class="num">${money(r.balance_due)}</td><td class="num"><strong class="${Number(r.net_profit)>=0?'profit-positive':'profit-negative'}">${money(r.net_profit)}</strong></td><td><button class="btn sm primary event-open" data-id="${r.id}">Butiran</button></td></tr>`).join(''):tableEmpty(10,'Tiada event ditemui.')}
        </tbody></table></div>
      </section>`;

    $('#evQty',root).addEventListener('input',()=>{$('#evPrice',root).value=defaultPrice($('#evQty',root).value).toFixed(2);});
    $('#evCostMode',root).addEventListener('change',()=>{$('#evBaseCost',root).disabled=$('#evCostMode',root).value==='itemized';});
    $('#eventCreateForm',root).addEventListener('submit',async e=>{
      e.preventDefault(); const b=e.submitter; setBusy(b,true,'Menyimpan...');
      const args={p_event_name:$('#evName',root).value.trim(),p_customer_name:$('#evCustomer',root).value.trim(),p_customer_phone:$('#evPhone',root).value.trim()||null,p_event_date:$('#evDate',root).value,p_location:$('#evLocation',root).value.trim()||null,p_quantity:Number($('#evQty',root).value),p_unit_price:Number($('#evPrice',root).value),p_delivery_charge:Number($('#evDeliveryIncome',root).value||0),p_notes:$('#evNotes',root).value.trim()||null,p_status:$('#evStatus',root).value,p_base_cost_mode:$('#evCostMode',root).value,p_base_unit_cost:$('#evCostMode',root).value==='combined'?Number($('#evBaseCost',root).value||0):0};
      const {data:id,error}=await state.supabase.rpc('admin_create_event',args); setBusy(b,false); if(error)return toast(error.message,'error');
      toast('Tempahan event berjaya disimpan.','success'); state.eventSelectedId=id; state.currentView='event-detail'; await adminEventDetail(root,id);
    });
    $('#eventFilterForm',root).addEventListener('submit',async e=>{e.preventDefault();state.eventFilters={search:$('#eventSearch',root).value.trim(),start:$('#eventStart',root).value,end:$('#eventEnd',root).value,status:$('#eventStatus',root).value};await adminEvents(root);});
    $$('.event-open',root).forEach(b=>b.addEventListener('click',async()=>{state.eventSelectedId=b.dataset.id;state.currentView='event-detail';await adminEventDetail(root,b.dataset.id);}));
  }

  async function adminEventDetail(root,id){
    if(!id){state.currentView='events';return adminEvents(root);}
    const {data,error}=await state.supabase.rpc('admin_event_detail',{p_event_id:id}); if(error)throw error; if(!data)throw new Error('Event tidak ditemui atau akses ditolak.');
    const e=data.event||{},payments=data.payments||[],costs=data.costs||[],commissions=data.commissions||[],partners=data.partners||[];
    const drinkSales=Number(e.quantity||0)*Number(e.unit_price||0),income=drinkSales+Number(e.customer_delivery_charge||0),received=sum(payments),balance=income-received,baseCost=e.base_cost_mode==='combined'?Number(e.quantity||0)*Number(e.base_unit_cost||0):0,totalCost=baseCost+sum(costs),totalComm=sum(commissions),net=income-totalCost-totalComm;
    const paidComm=sum(commissions.filter(x=>x.status==='paid')),pendingComm=totalComm-paidComm;

    root.innerHTML=pageHead('EVENT','Butiran Event',`${e.event_name} • ${e.customer_name}`,`<button class="btn ghost" id="eventBack">← Senarai Event</button>`)+`
      <div class="kpi-grid">
        ${kpi('Jualan Minuman',money(drinkSales))}${kpi('Caj Delivery Pelanggan',money(e.customer_delivery_charge))}${kpi('Jumlah Pendapatan',money(income))}${kpi('Bayaran Diterima',money(received))}${kpi('Baki Pelanggan',money(balance))}${kpi('Jumlah Kos',money(totalCost))}${kpi('Jumlah Komisen',money(totalComm),`Paid ${money(paidComm)} • Pending ${money(pendingComm)}`)}${kpi(net>=0?'Untung Bersih':'Kerugian',`<span class="${net>=0?'profit-positive':'profit-negative'}">${money(net)}</span>`)}
      </div>

      <section class="panel"><div class="panel-head"><div><h3>Maklumat Tempahan</h3><p>Produk 100ml • chilled. Harga disimpan sebagai snapshot event ini.</p></div></div>
        <form id="eventEditForm" class="form-stack"><div class="grid-2">
          <label>Nama event<input id="edName" required value="${esc(e.event_name)}"></label><label>Nama pelanggan<input id="edCustomer" required value="${esc(e.customer_name)}"></label>
          <label>Telefon<input id="edPhone" value="${esc(e.customer_phone||'')}"></label><label>Tarikh<input id="edDate" type="date" value="${esc(e.event_date)}" required></label>
          <label>Lokasi<input id="edLocation" value="${esc(e.location||'')}"></label><label>Kuantiti<input id="edQty" type="number" min="200" value="${e.quantity}" required></label>
          <label>Harga / botol RM<input id="edPrice" type="number" min="0" step="0.01" value="${Number(e.unit_price).toFixed(2)}" required></label><label>Caj delivery pelanggan RM<input id="edDelivery" type="number" min="0" step="0.01" value="${Number(e.customer_delivery_charge||0).toFixed(2)}"></label>
          <label>Status<select id="edStatus">${Object.entries(statusLabel).map(([v,l])=>`<option value="${v}" ${e.status===v?'selected':''}>${l}</option>`).join('')}</select></label>
          <label>Kaedah kos<select id="edCostMode"><option value="combined" ${e.base_cost_mode==='combined'?'selected':''}>Gabungan bahan + botol</option><option value="itemized" ${e.base_cost_mode==='itemized'?'selected':''}>Pecahan satu-satu</option></select></label>
          <label>Kos gabungan / botol RM<input id="edBaseCost" type="number" min="0" step="0.0001" value="${Number(e.base_unit_cost||0).toFixed(4)}" ${e.base_cost_mode==='itemized'?'disabled':''}></label>
        </div><label>Catatan<textarea id="edNotes" rows="3">${esc(e.notes||'')}</textarea></label><button class="btn primary" type="submit">Update Event</button></form>
      </section>

      <div class="grid-2">
        <section class="panel"><div class="panel-head"><div><h3>Bayaran Pelanggan</h3><p>Kutipan tunai direkod berasingan daripada keuntungan.</p></div></div>
          <form id="eventPaymentForm" class="form-stack"><label>Jumlah RM<input id="payAmount" type="number" min="0.01" step="0.01" required></label><label>Tarikh / masa<input id="payDate" type="datetime-local" value="${isoLocal(new Date())}"></label><label>Nota<input id="payNotes"></label><button class="btn primary" type="submit">Tambah Bayaran</button></form>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Tarikh</th><th>Nota</th><th class="num">Jumlah</th></tr></thead><tbody>${payments.length?payments.map(x=>`<tr><td>${dateMY(x.paid_at)}</td><td>${esc(x.notes||'-')}</td><td class="num">${money(x.amount)}</td></tr>`).join(''):tableEmpty(3)}</tbody></table></div>
        </section>

        <section class="panel"><div class="panel-head"><div><h3>Kos Event</h3><p>${e.base_cost_mode==='combined'?`Kos gabungan semasa: ${num(e.quantity)} × ${money(e.base_unit_cost)} = ${money(baseCost)}. Bahan/Botol tambahan disekat.`:'Kos bahan dan botol direkod satu-satu.'}</p></div></div>
          <form id="eventCostForm" class="form-stack"><label>Kategori<select id="costCategory">${Object.entries(costLabel).map(([v,l])=>`<option value="${v}" ${(e.base_cost_mode==='combined'&&(v==='beverage_material'||v==='bottle'))?'disabled':''}>${l}</option>`).join('')}</select></label><label>Keterangan<input id="costDesc"></label><label>Jumlah RM<input id="costAmount" type="number" min="0" step="0.01" required></label><button class="btn primary" type="submit">Tambah Kos</button></form>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Kategori</th><th>Keterangan</th><th class="num">Jumlah</th></tr></thead><tbody>${costs.length?costs.map(x=>`<tr><td>${esc(costLabel[x.category]||x.category)}</td><td>${esc(x.description||'-')}</td><td class="num">${money(x.amount)}</td></tr>`).join(''):tableEmpty(3)}</tbody></table></div>
        </section>
      </div>

      <section class="panel"><div class="panel-head"><div><h3>Komisen / Upah Event</h3><p>Kadar awal RM0.80/botol, berasingan daripada Rider/Ejen. Pending tetap ditolak daripada untung.</p></div></div>
        <form id="eventCommissionForm" class="inline-form"><div class="field"><label>Penerima</label><input id="commName" required></div><div class="field"><label>Kadar / botol RM</label><input id="commRate" type="number" min="0" step="0.01" value="0.80" required></div><div class="field"><label>Kuantiti</label><input id="commQty" type="number" min="1" value="${e.quantity}" required></div><div class="field"><label>Nota</label><input id="commNotes"></div><button class="btn primary" type="submit">Tambah Komisen</button></form>
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Penerima</th><th class="num">Rate</th><th class="num">Qty</th><th class="num">Jumlah</th><th>Status</th><th>Bayar</th></tr></thead><tbody>${commissions.length?commissions.map(x=>`<tr><td><strong>${esc(x.recipient_name)}</strong><br><span class="muted">${esc(x.notes||'')}</span></td><td class="num">${money(x.rate_per_bottle)}</td><td class="num">${num(x.quantity)}</td><td class="num">${money(x.amount)}</td><td>${x.status==='paid'?'Sudah dibayar':'Belum dibayar'}</td><td><button class="btn sm ghost comm-toggle" data-id="${x.id}" data-status="${x.status==='paid'?'pending':'paid'}">${x.status==='paid'?'Tanda Belum Bayar':'Tanda Sudah Bayar'}</button></td></tr>`).join(''):tableEmpty(6)}</tbody></table></div>
      </section>

      <section class="panel"><div class="panel-head"><div><h3>Pembahagian Partner 50 / 50</h3><p>Pembayaran partner ialah distribution keuntungan, bukan kos event tambahan.</p></div></div>
        ${net<0?`<div class="panel empty-state"><strong class="profit-negative">Event rugi ${money(Math.abs(net))}</strong><br>Tiada keuntungan untuk diagihkan.</div>`:''}
        <div class="table-wrap"><table class="data-table"><thead><tr><th>Partner</th><th>Share</th><th class="num">Jumlah</th><th>Status</th><th>Tarikh Bayar</th><th></th></tr></thead><tbody>${partners.length?partners.map(x=>`<tr><td><strong>${esc(x.partner_name)}</strong></td><td>${num(x.share_percent,2)}%</td><td class="num">${money(x.amount)}</td><td>${x.status==='paid'?'Sudah dibayar':'Belum dibayar'}</td><td>${dateMY(x.paid_at)}</td><td><button class="btn sm ghost partner-toggle" data-id="${x.id}" data-status="${x.status==='paid'?'pending':'paid'}" ${Number(x.amount)<=0?'disabled':''}>${x.status==='paid'?'Tanda Belum Bayar':'Tanda Sudah Bayar'}</button></td></tr>`).join(''):tableEmpty(6)}</tbody></table></div>
        <div class="muted">Jumlah bahagian: ${money(sum(partners))} • Untung boleh diagih: ${money(Math.max(net,0))}</div>
      </section>`;

    $('#eventBack',root).addEventListener('click',async()=>{state.currentView='events';await adminEvents(root);});
    $('#edCostMode',root).addEventListener('change',()=>{$('#edBaseCost',root).disabled=$('#edCostMode',root).value==='itemized';});
    $('#eventEditForm',root).addEventListener('submit',async ev=>{ev.preventDefault();const b=ev.submitter;setBusy(b,true,'Updating...');const args={p_event_id:id,p_event_name:$('#edName',root).value.trim(),p_customer_name:$('#edCustomer',root).value.trim(),p_customer_phone:$('#edPhone',root).value.trim()||null,p_event_date:$('#edDate',root).value,p_location:$('#edLocation',root).value.trim()||null,p_quantity:Number($('#edQty',root).value),p_unit_price:Number($('#edPrice',root).value),p_delivery_charge:Number($('#edDelivery',root).value||0),p_notes:$('#edNotes',root).value.trim()||null,p_status:$('#edStatus',root).value,p_base_cost_mode:$('#edCostMode',root).value,p_base_unit_cost:$('#edCostMode',root).value==='combined'?Number($('#edBaseCost',root).value||0):0};const{error}=await state.supabase.rpc('admin_update_event',args);setBusy(b,false);if(error)return toast(error.message,'error');toast('Event dikemas kini.','success');await adminEventDetail(root,id);});
    $('#eventPaymentForm',root).addEventListener('submit',async ev=>{ev.preventDefault();const b=ev.submitter;setBusy(b,true);const dt=$('#payDate',root).value?new Date($('#payDate',root).value).toISOString():new Date().toISOString();const{error}=await state.supabase.rpc('admin_add_event_payment',{p_event_id:id,p_amount:Number($('#payAmount',root).value),p_paid_at:dt,p_notes:$('#payNotes',root).value.trim()||null});setBusy(b,false);if(error)return toast(error.message,'error');toast('Bayaran direkod.','success');await adminEventDetail(root,id);});
    $('#eventCostForm',root).addEventListener('submit',async ev=>{ev.preventDefault();const b=ev.submitter;setBusy(b,true);const{error}=await state.supabase.rpc('admin_add_event_cost',{p_event_id:id,p_category:$('#costCategory',root).value,p_description:$('#costDesc',root).value.trim()||null,p_amount:Number($('#costAmount',root).value),p_incurred_at:new Date().toISOString()});setBusy(b,false);if(error)return toast(error.message,'error');toast('Kos event ditambah.','success');await adminEventDetail(root,id);});
    $('#eventCommissionForm',root).addEventListener('submit',async ev=>{ev.preventDefault();const b=ev.submitter;setBusy(b,true);const{error}=await state.supabase.rpc('admin_add_event_commission',{p_event_id:id,p_recipient_name:$('#commName',root).value.trim(),p_rate:Number($('#commRate',root).value),p_quantity:Number($('#commQty',root).value),p_notes:$('#commNotes',root).value.trim()||null});setBusy(b,false);if(error)return toast(error.message,'error');toast('Komisen event ditambah.','success');await adminEventDetail(root,id);});
    $$('.comm-toggle',root).forEach(b=>b.addEventListener('click',async()=>{const{error}=await state.supabase.rpc('admin_set_event_commission_status',{p_commission_id:b.dataset.id,p_status:b.dataset.status,p_paid_at:b.dataset.status==='paid'?new Date().toISOString():null});if(error)return toast(error.message,'error');toast('Status komisen dikemas kini.','success');await adminEventDetail(root,id);}));
    $$('.partner-toggle',root).forEach(b=>b.addEventListener('click',async()=>{const{error}=await state.supabase.rpc('admin_set_event_partner_status',{p_share_id:b.dataset.id,p_status:b.dataset.status,p_paid_at:b.dataset.status==='paid'?new Date().toISOString():null});if(error)return toast(error.message,'error');toast('Status bahagian partner dikemas kini.','success');await adminEventDetail(root,id);}));
  }
})();
