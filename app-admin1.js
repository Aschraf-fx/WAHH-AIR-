async function renderAdmin(view, root) {
  const map={dashboard:adminDashboard,members:adminMembers,stock:adminStock,flavours:adminFlavours,materials:adminMaterials,purchases:adminPurchases,expenses:adminExpenses,sales:adminSales,invoices:adminInvoices,accounting:adminAccounting,partners:adminPartners,posters:adminPosters,audit:adminAudit};
  return (map[view]||adminDashboard)(root);
}

async function adminDashboard(root){
  const {data,error}=await state.supabase.rpc('admin_dashboard_summary');if(error)throw error;const s=data?.[0]||{};
  root.innerHTML=pageHead('ADMIN','Dashboard WAHH AIR','Pusat kawalan operasi, stok, jualan dan accounting.')+`<div class="kpi-grid">${kpi('Sales Hari Ini',money(s.today_sales))}${kpi('Unit Hari Ini',num(s.today_units))}${kpi('Active Rider/Ejen',num(s.active_members))}${kpi('Total Stok Air',`${num(s.total_stock)} unit`)}</div><div class="grid-2"><section class="panel"><div class="panel-head"><div><h3>Bulan Ini</h3><p>Management P&L semasa.</p></div><button class="btn soft sm" data-view="accounting">Accounting</button></div><div class="grid-2">${kpi('Revenue',money(s.month_revenue))}${kpi('Net Profit',money(s.month_net_profit))}</div></section><section class="panel"><div class="panel-head"><div><h3>Tindakan Pantas</h3><p>Operasi harian.</p></div></div><div class="grid-2"><button class="btn primary" data-view="stock">Manage Stock</button><button class="btn ghost" data-view="sales">Update Jualan</button><button class="btn ghost" data-view="purchases">Belian Stock</button><button class="btn ghost" data-view="invoices">Invoices</button></div></section></div>`;
}

async function adminMembers(root){
  const {data,error}=await state.supabase.rpc('admin_list_members');if(error)throw error;
  root.innerHTML=pageHead('ADMIN','Rider / Ejen','Admin melihat Public ID dan maklumat operasi, bukan Auth UUID atau password.')+`<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Public ID</th><th>Nama</th><th>Telefon</th><th>Role</th><th>Status</th><th>Daftar</th><th>Tindakan</th></tr></thead><tbody>${data?.length?data.map(r=>`<tr><td><strong>${esc(r.public_id)}</strong></td><td>${esc(r.full_name)}</td><td>${esc(r.phone||'-')}</td><td><span class="role-badge">${esc(r.role)}</span></td><td><span class="status-badge ${esc(r.status)}">${esc(r.status)}</span></td><td>${dateMY(r.created_at)}</td><td><div class="row-actions" style="margin:0;justify-content:flex-start"><button class="btn sm ghost member-status" data-id="${esc(r.public_id)}" data-status="${r.status==='active'?'suspended':'active'}">${r.status==='active'?'Suspend':'Aktifkan'}</button><button class="btn sm danger member-delete" data-id="${esc(r.public_id)}">Delete</button></div></td></tr>`).join(''):tableEmpty(7)}</tbody></table></div></section>`;
  $$('.member-status',root).forEach(b=>b.addEventListener('click',()=>updateMemberStatus(b.dataset.id,b.dataset.status)));
  $$('.member-delete',root).forEach(b=>b.addEventListener('click',()=>deleteMember(b.dataset.id)));
}
async function updateMemberStatus(publicId,status){const ok=await confirmAction('Tukar status akaun?',`${publicId} akan ditetapkan sebagai ${status}.`);if(!ok)return;const{error}=await state.supabase.rpc('admin_set_member_status',{p_public_id:publicId,p_status:status});if(error)return toast(error.message,'error');toast('Status dikemas kini.','success');renderView('members');}
async function deleteMember(publicId){const ok=await confirmAction('Delete akaun?',`Akaun ${publicId} akan dipadam daripada Authentication dan database. Tindakan ini tidak boleh dibatalkan.`);if(!ok)return;const token=state.session.access_token;const res=await fetch('/api/admin-delete-user',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({publicId})});const out=await res.json().catch(()=>({}));if(!res.ok)return toast(out.error||'Delete gagal.','error');toast(`${publicId} telah dipadam.`,'success');renderView('members');}

/* adminStock used to hold its own copy of the whole inventory screen. It has been
   dead code since app-inventory-redesign.js started replacing renderAdmin for the
   'stock' view, and keeping two divergent implementations is how the two halves of
   the screen drifted apart (one accepted absolute balances, the other only deltas).
   The real screen now lives in app-inventory-redesign.js; this delegates to it so
   the sidebar item still works if that module is slow to load. */
async function adminStock(root){
  if(typeof window.wahhRenderInventory==='function') return window.wahhRenderInventory(root);
  return adminDashboard(root);
}

async function adminFlavours(root){
  const{data,error}=await state.supabase.from('flavours').select('*').order('created_at');if(error)throw error;
  root.innerHTML=pageHead('PRODUCT','Perisa & Harga','Tambah perisa, harga jual, minimum stok dan manual COGS fallback.')+`<section class="panel"><form id="flavourForm" class="inline-form"><div class="field"><label>Nama Perisa</label><input id="flName" required placeholder="Honeydew"></div><div class="field"><label>Harga Jual RM</label><input id="flPrice" type="number" min="0" step="0.01" required value="5"></div><div class="field"><label>Manual COGS RM</label><input id="flCogs" type="number" min="0" step="0.01" value="0"></div><div class="field"><label>Low Stock</label><input id="flLow" type="number" min="0" value="10"></div><button class="btn primary" type="submit">Tambah</button></form></section><section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Perisa</th><th class="num">Harga</th><th class="num">Manual COGS</th><th class="num">Low Stock</th><th>Status</th><th>Tindakan</th></tr></thead><tbody>${data?.length?data.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td class="num">${money(r.selling_price)}</td><td class="num">${money(r.manual_unit_cogs)}</td><td class="num">${num(r.low_stock_threshold)}</td><td><button class="btn sm ${r.active?'success':'ghost'} flavour-toggle" data-id="${r.id}" data-active="${!r.active}">${r.active?'Active':'Inactive'}</button></td><td class="inv-actions-cell"><button class="btn sm ghost flavour-edit" type="button" data-id="${r.id}" data-name="${esc(r.name)}" data-price="${r.selling_price}" data-cogs="${r.manual_unit_cogs}" data-low="${r.low_stock_threshold}" data-slug="${esc(r.slug)}">Edit</button></td></tr>`).join(''):tableEmpty(5)}</tbody></table></div></section>`;
  $('#flavourForm',root).addEventListener('submit',async e=>{e.preventDefault();const slug=$('#flName').value.trim().toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');const{error}=await state.supabase.from('flavours').insert({name:$('#flName').value.trim(),slug,selling_price:Number($('#flPrice').value),manual_unit_cogs:Number($('#flCogs').value),low_stock_threshold:Number($('#flLow').value)});if(error)return toast(error.message,'error');toast('Perisa ditambah.','success');await loadPublic();renderView('flavours');});
  $$('.flavour-toggle',root).forEach(b=>b.addEventListener('click',async()=>{const{error}=await state.supabase.from('flavours').update({active:b.dataset.active==='true'}).eq('id',b.dataset.id);if(error)return toast(error.message,'error');toast('Status perisa dikemas kini.','success');await loadPublic();renderView('flavours');}));

  /* Price, manual COGS and the low-stock threshold used to be create-only: once a
     flavour existed the only thing you could change was its active flag, so a price
     change meant editing the database by hand. Now editable inline. */
  $$('.flavour-edit',root).forEach(b=>b.addEventListener('click',()=>{
    const d=b.dataset;
    const open=window.wahhOpenDialog;
    if(typeof open!=='function') return toast('Dialog tidak tersedia. Muat semula halaman.','error');
    open({
      title:`Edit perisa — ${d.name}`,
      description:'Harga jual dipakai pada jualan baru. Manual COGS ialah kos seunit simpanan bila recipe belum lengkap. Low stock menentukan bila amaran stok keluar.',
      fields:[
        {name:'name',label:'Nama perisa',type:'text',required:true,maxlength:120,value:d.name},
        {name:'price',label:'Harga jual (RM)',type:'number',min:0,step:0.01,inputmode:'decimal',required:true,value:d.price},
        {name:'cogs',label:'Manual COGS (RM)',type:'number',min:0,step:0.01,inputmode:'decimal',required:true,value:d.cogs},
        {name:'low',label:'Paras low stock',type:'number',min:0,step:1,inputmode:'numeric',required:true,value:d.low,hint:'Stok HQ pada atau bawah paras ini ditandakan low stock.'}
      ],
      submitLabel:'Simpan perubahan',
      onSubmit:async({read,num})=>{
        const name=read('name').trim();
        const price=num('price');
        const cogs=num('cogs');
        const low=num('low');
        if(!name)return toast('Nama perisa diperlukan.','warning'),false;
        if(!Number.isFinite(price)||price<0)return toast('Harga jual tidak sah.','warning'),false;
        if(!Number.isFinite(cogs)||cogs<0)return toast('Manual COGS tidak sah.','warning'),false;
        if(!Number.isInteger(low)||low<0)return toast('Paras low stock tidak sah.','warning'),false;
        const slug=name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
        const{error}=await state.supabase.from('flavours').update({name,slug,selling_price:price,manual_unit_cogs:cogs,low_stock_threshold:low}).eq('id',d.id);
        if(error){toast(error.message,'error');return false;}
        toast(`Perisa "${name}" dikemas kini.`,'success');
        await loadPublic();
        renderView('flavours');
      }
    });
  }));
}
