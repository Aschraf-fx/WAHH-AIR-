async function renderUser(view, root) {
  const map = {
    dashboard: userDashboard,
    'new-sale': userNewSale,
    history: userHistory,
    'my-stock': userStock,
    commission: userCommission,
    directory: userDirectory,
    profile: userProfile,
  };
  return (map[view] || userDashboard)(root);
}

async function userDashboard(root) {
  const [{ data: summary, error }, { data: stock }] = await Promise.all([
    state.supabase.rpc('get_my_dashboard'), state.supabase.rpc('get_my_stock')
  ]);
  if (error) throw error;
  const s = summary?.[0] || {};
  root.innerHTML = pageHead(state.profile.role === 'agent' ? 'EJEN' : 'RIDER', `Hai, ${state.profile.full_name}`, `${state.profile.public_id} • Ringkasan jualan hari ini.`) + `
    <div class="kpi-grid">${kpi('Sales Hari Ini', money(s.today_sales))}${kpi('Unit Terjual', num(s.today_units))}${kpi('Komisen Hari Ini', money(s.today_commission))}${kpi('Stok Semasa', `${num(s.current_stock)} unit`)}</div>
    <div class="grid-2"><section class="panel"><div class="panel-head"><div><h3>Stok Saya</h3><p>Stok yang diperuntukkan kepada akaun ini.</p></div><button class="btn soft sm" data-view="my-stock">Lihat semua</button></div>${stockCards(stock||[])}</section>
    <section class="panel"><div class="panel-head"><div><h3>Quick Action</h3><p>Jualan final akan auto hasilkan invoice untuk Admin.</p></div></div><div class="grid-2"><button class="btn primary" data-view="new-sale">+ Update Jualan</button><button class="btn ghost" data-view="history">Sales History</button></div></section></div>`;
}
function stockCards(rows) {
  if (!rows.length) return `<div class="empty-state">Belum ada stok diperuntukkan.</div>`;
  return `<div class="grid-2">${rows.map(r=>`<div class="quick-card"><strong>${esc(r.flavour_name)}</strong><span>${num(r.quantity)} unit • ${money(r.selling_price)}/unit</span></div>`).join('')}</div>`;
}

async function userNewSale(root) {
  const { data: stock, error } = await state.supabase.rpc('get_my_stock'); if (error) throw error;
  root.innerHTML = pageHead('JUALAN', 'Update Jualan', 'Masukkan kuantiti terjual. Bila finalize, stok, komisen, accounting dan invoice akan dikemas kini serentak.') + `
    <section class="panel"><form id="saleForm"><div class="sale-lines">${(stock||[]).map(r=>`<div class="sale-line" data-flavour="${r.flavour_id}" data-price="${r.selling_price}" data-stock="${r.quantity}"><div class="line-name"><strong>${esc(r.flavour_name)}</strong><div class="price">Stok: ${num(r.quantity)} • ${money(r.selling_price)}/unit</div></div><div><label class="field-label">Qty<input class="sale-qty field-input" type="number" min="0" max="${r.quantity}" value="0"></label></div><div class="price line-total">${money(0)}</div></div>`).join('')}</div>
    <label class="field-label" style="margin-top:14px">Nota<textarea id="saleNotes" class="field-input" rows="3" placeholder="Optional"></textarea></label>
    <div class="totals-box"><div class="total-row grand"><span>Anggaran Sales</span><strong id="saleEstimate">${money(0)}</strong></div><button class="btn primary full" type="submit">Finalize Jualan</button></div></form></section>`;
  $$('.sale-qty', root).forEach(i => i.addEventListener('input', recalcSale));
  $('#saleForm',root).addEventListener('submit', submitUserSale);
}
function recalcSale() {
  let total=0;
  $$('.sale-line').forEach(line=>{ const qty=Number($('.sale-qty',line)?.value||0), price=Number(line.dataset.price||0); total+=qty*price; $('.line-total',line).textContent=money(qty*price); });
  $('#saleEstimate').textContent=money(total);
}
async function submitUserSale(e) {
  e.preventDefault();
  const items = $$('.sale-line').map(line => ({ flavour_id: line.dataset.flavour, quantity: Number($('.sale-qty',line).value||0) })).filter(x=>x.quantity>0);
  if (!items.length) return toast('Masukkan sekurang-kurangnya satu jualan.', 'warning');
  const ok = await confirmAction('Finalize jualan?', 'Selepas finalize, stok akan ditolak dan invoice akan dikeluarkan secara automatik untuk Admin.'); if (!ok) return;
  const btn=e.submitter; setBusy(btn,true,'Finalizing...');
  const { data,error } = await state.supabase.rpc('finalize_sale',{p_items:items,p_notes:$('#saleNotes').value.trim()||null});
  setBusy(btn,false); if(error) return toast(error.message,'error');
  const r=data?.[0]||{}; toast(`Jualan berjaya. Invoice ${r.invoice_no||''} telah dijana.`, 'success');
  state.currentView='dashboard'; await renderView('dashboard');
}

async function userHistory(root) {
  const {data,error}=await state.supabase.rpc('get_my_sales',{p_limit:100}); if(error) throw error;
  root.innerHTML=pageHead('REKOD','Sales History','Invoice disimpan di bahagian Admin sahaja.')+`<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Tarikh</th><th>Status</th><th class="num">Sales</th><th class="num">Komisen</th><th class="num">Net WAHH</th></tr></thead><tbody>${data?.length?data.map(r=>`<tr><td>${dateMY(r.sale_date)}</td><td><span class="status-badge ${r.status==='finalized'?'active':'terminated'}">${esc(r.status)}</span></td><td class="num">${money(r.total_amount)}</td><td class="num">${money(r.commission_amount)}</td><td class="num">${money(r.net_to_business)}</td></tr>`).join(''):tableEmpty(5)}</tbody></table></div></section>`;
}
async function userStock(root) {
  const {data,error}=await state.supabase.rpc('get_my_stock'); if(error) throw error;
  root.innerHTML=pageHead('INVENTORY','Stok Saya','Stok yang telah diperuntukkan oleh Admin.')+`<div class="stock-grid">${data?.length?data.map(r=>`<article class="stock-card"><h3>${esc(r.flavour_name)}</h3><div class="stock-value">${num(r.quantity)} <small>unit</small></div><div class="stock-sub">${money(r.selling_price)} / unit</div></article>`).join(''):setupNotice('Belum ada stok.')}</div>`;
}
async function userCommission(root) {
  const {data,error}=await state.supabase.rpc('get_my_commission_summary'); if(error) throw error; const s=data?.[0]||{};
  root.innerHTML=pageHead('UPAH','Komisen Saya','Komisen diiktiraf bila jualan difinalize. Status bayaran dikawal Admin.')+`<div class="kpi-grid">${kpi('Total Earned',money(s.total_earned))}${kpi('Pending',money(s.pending_amount))}${kpi('Approved',money(s.approved_amount))}${kpi('Paid',money(s.paid_amount))}</div>`;
}
async function userDirectory(root) {
  const {data,error}=await state.supabase.rpc('get_public_member_stock'); if(error) throw error;
  root.innerHTML=pageHead('PUBLIC','Stok Rider & Ejen','Data public terhad kepada ID, role dan stok sahaja.')+`<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Role</th><th>Perisa</th><th class="num">Qty</th></tr></thead><tbody>${data?.length?data.map(r=>`<tr><td><strong>${esc(r.public_id)}</strong></td><td>${esc(r.role)}</td><td>${esc(r.flavour_name)}</td><td class="num">${num(r.quantity)}</td></tr>`).join(''):tableEmpty(4)}</tbody></table></div></section>`;
}
async function userProfile(root) {
  root.innerHTML=pageHead('AKAUN','Profil Saya','Maklumat ini private dan hanya boleh dilihat oleh anda serta Admin.')+`<section class="panel"><form id="profileForm" class="form-stack" style="max-width:560px"><label>Public ID<input value="${esc(state.profile.public_id)}" disabled></label><label>Nama penuh<input id="pfName" value="${esc(state.profile.full_name)}" required maxlength="80"></label><label>No. telefon<input id="pfPhone" value="${esc(state.profile.phone||'')}" maxlength="30"></label><button class="btn primary" type="submit">Simpan Profil</button></form></section>`;
  $('#profileForm',root).addEventListener('submit', async e=>{e.preventDefault();const b=e.submitter;setBusy(b,true);const{data,error}=await state.supabase.rpc('update_my_profile',{p_full_name:$('#pfName').value.trim(),p_phone:$('#pfPhone').value.trim()||null});setBusy(b,false);if(error)return toast(error.message,'error');state.profile={...state.profile,...(data?.[0]||{})};$('#navIdentity').textContent=`${state.profile.public_id} • ${state.profile.full_name}`;toast('Profil dikemas kini.','success');});
}
