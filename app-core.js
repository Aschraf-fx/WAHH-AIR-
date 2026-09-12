/* WAHH AIR! Portal — Vanilla HTML/CSS/JS + Supabase */
const state = {
  supabase: null,
  session: null,
  profile: null,
  flavours: [],
  currentView: 'dashboard',
  confirmResolver: null,
};

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const money = (n) => new Intl.NumberFormat('ms-MY', { style: 'currency', currency: 'MYR' }).format(Number(n || 0));
const num = (n, d = 0) => new Intl.NumberFormat('ms-MY', { maximumFractionDigits: d }).format(Number(n || 0));
const dateMY = (v) => v ? new Intl.DateTimeFormat('ms-MY', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(v)) : '-';
const todayISO = () => new Date().toISOString().slice(0, 10);
const monthStartISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-01`; };
const monthEndISO = () => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10); };
const esc = (v='') => String(v).replace(/[&<>'\"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#039;','\"':'&quot;'}[c]));

function toast(message, type = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast show ${type}`;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.className = 'toast', 3400);
}

function openModal(id) { $(`#${id}`)?.classList.remove('hidden'); }
function closeModal(id) { $(`#${id}`)?.classList.add('hidden'); }
function setBusy(btn, busy, text = 'Memproses...') {
  if (!btn) return;
  if (busy) { btn.dataset.oldText = btn.textContent; btn.disabled = true; btn.textContent = text; }
  else { btn.disabled = false; btn.textContent = btn.dataset.oldText || btn.textContent; }
}
function confirmAction(title, text) {
  $('#confirmTitle').textContent = title;
  $('#confirmText').textContent = text;
  openModal('confirmModal');
  return new Promise(resolve => { state.confirmResolver = resolve; });
}

async function init() {
  bindStaticEvents();
  try {
    const res = await fetch('/api/config', { cache: 'no-store' });
    if (!res.ok) throw new Error('Config belum disediakan');
    const cfg = await res.json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('Supabase env belum lengkap');
    state.supabase = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });

    state.supabase.auth.onAuthStateChange(async (event, session) => {
      state.session = session;
      if (event === 'PASSWORD_RECOVERY') {
        const next = window.prompt('Masukkan password baru (minimum 6 aksara):');
        if (next && next.length >= 6) {
          const { error } = await state.supabase.auth.updateUser({ password: next });
          toast(error ? error.message : 'Password berjaya dikemas kini.', error ? 'error' : 'success');
        }
      }
      if (!session) {
        showPublic();
        return;
      }
      // Supabase may emit TOKEN_REFRESHED / SIGNED_IN again when a browser tab
      // regains focus. If the portal is already active, keep the current module
      // instead of re-entering the portal and resetting it to Dashboard.
      if (state.profile) return;
      await enterPortal();
    });

    const { data } = await state.supabase.auth.getSession();
    state.session = data.session;
    await loadPublic();
    if (state.session && !state.profile) await enterPortal();
  } catch (e) {
    console.warn(e);
    $('#publicStockGrid').innerHTML = setupNotice('Supabase belum disambungkan. Isi Environment Variables di Vercel selepas menjalankan schema.sql.');
    $('#publicMemberGrid').innerHTML = '';
  }
}

function bindStaticEvents() {
  document.addEventListener('click', async (e) => {
    const open = e.target.closest('[data-open]');
    if (open) openModal(open.dataset.open);
    const close = e.target.closest('[data-close]');
    if (close) closeModal(close.dataset.close);
    const menu = e.target.closest('[data-view]');
    if (menu) { state.currentView = menu.dataset.view; await renderView(state.currentView); closeMobileMenu(); }
  });
  $$('.modal').forEach(m => m.addEventListener('click', e => { if (e.target === m && m.id !== 'confirmModal') closeModal(m.id); }));
  $('#loginForm').addEventListener('submit', login);
  $('#registerForm').addEventListener('submit', register);
  $('#logoutBtn').addEventListener('click', async () => { if (state.supabase) await state.supabase.auth.signOut(); });
  $('#forgotPasswordBtn').addEventListener('click', forgotPassword);
  $('#mobileMenuBtn').addEventListener('click', () => $('.sidebar')?.classList.toggle('open'));
  $('#printInvoiceBtn').addEventListener('click', () => window.print());
  $('#confirmCancel').addEventListener('click', () => finishConfirm(false));
  $('#confirmOk').addEventListener('click', () => finishConfirm(true));
}
function finishConfirm(value) { closeModal('confirmModal'); state.confirmResolver?.(value); state.confirmResolver = null; }
function closeMobileMenu() { $('.sidebar')?.classList.remove('open'); }
function setupNotice(text) { return `<div class="panel empty-state" style="grid-column:1/-1"><strong>Setup diperlukan</strong><br>${esc(text)}</div>`; }

async function loadPublic() {
  if (!state.supabase) return;
  const [fl, posters, stock, members] = await Promise.all([
    state.supabase.from('flavours').select('id,name,selling_price,active').eq('active', true).order('name'),
    state.supabase.from('posters').select('id,title,storage_path,created_at').eq('active', true).order('sort_order').order('created_at', { ascending:false }),
    state.supabase.rpc('get_public_flavour_stock'),
    state.supabase.rpc('get_public_members')
  ]);
  state.flavours = fl.data || [];
  renderPublicPosters(posters.data || []);
  renderPublicStock(stock.data || []);
  renderPublicMembers(members.data || []);
}
function renderPublicPosters(rows) {
  const grid = $('#posterGrid');
  if (!rows.length) return;
  grid.innerHTML = rows.map(p => {
    const { data } = state.supabase.storage.from('posters').getPublicUrl(p.storage_path);
    return `<article class="poster-card"><img src="${esc(data.publicUrl)}" alt="${esc(p.title)}"><div class="poster-meta"><strong>${esc(p.title)}</strong><span>WAHH AIR!</span></div></article>`;
  }).join('');
}
function renderPublicStock(rows) {
  $('#publicStockGrid').innerHTML = rows.length ? rows.map(r => `<article class="stock-card">
    <h3>${esc(r.flavour_name)}</h3><div class="stock-value">${num(r.quantity)} <small>unit</small></div>
    <div class="stock-sub">${money(r.selling_price)} / unit</div>
    <div class="status-dot ${r.stock_status === 'LIMITED' ? 'limited' : r.stock_status === 'OUT' ? 'out' : ''}">${esc(r.stock_status)}</div>
  </article>`).join('') : setupNotice('Belum ada stok aktif.');
}
function renderPublicMembers(rows) {
  $('#publicMemberGrid').innerHTML = rows.length ? rows.map(r => `<article class="member-card"><div><strong>${esc(r.public_id)}</strong><br><span>${r.role === 'agent' ? 'Ejen' : 'Rider'}</span></div><span class="status-badge ${esc(r.status)}">${esc(r.status)}</span></article>`).join('') : `<div class="muted">Belum ada Rider/Ejen aktif.</div>`;
}

async function login(e) {
  e.preventDefault();
  if (!state.supabase) return toast('Supabase belum disambungkan.', 'error');
  const btn = e.submitter; setBusy(btn, true, 'Login...');
  const role = $('#loginRole').value;
  const { data, error } = await state.supabase.auth.signInWithPassword({ email: $('#loginEmail').value.trim(), password: $('#loginPassword').value });
  if (error) { setBusy(btn,false); return toast(error.message, 'error'); }
  const { data: profile, error: pe } = await state.supabase.from('profiles').select('public_id,full_name,phone,role,status').eq('id', data.user.id).single();
  if (pe || !profile) { await state.supabase.auth.signOut(); setBusy(btn,false); return toast('Profil akaun tidak ditemui.', 'error'); }
  if (profile.status !== 'active') { await state.supabase.auth.signOut(); setBusy(btn,false); return toast(`Akaun ${profile.status}. Hubungi Admin.`, 'error'); }
  if (profile.role !== role) { await state.supabase.auth.signOut(); setBusy(btn,false); return toast(`Akaun ini didaftarkan sebagai ${profile.role.toUpperCase()}, bukan ${role.toUpperCase()}.`, 'error'); }
  closeModal('loginModal'); setBusy(btn,false);
}

async function register(e) {
  e.preventDefault();
  if (!state.supabase) return toast('Supabase belum disambungkan.', 'error');
  const btn = e.submitter; setBusy(btn,true,'Mendaftar...');
  const payload = {
    email: $('#registerEmail').value.trim(),
    password: $('#registerPassword').value,
    options: { data: { full_name: $('#registerName').value.trim(), phone: $('#registerPhone').value.trim(), role: $('#registerRole').value } }
  };
  const { data, error } = await state.supabase.auth.signUp(payload);
  setBusy(btn,false);
  if (error) return toast(error.message, 'error');
  closeModal('registerModal');
  $('#registerForm').reset();
  toast(data.session ? 'Akaun berjaya didaftarkan.' : 'Pendaftaran berjaya. Semak email untuk pengesahan.', 'success');
}

async function forgotPassword() {
  if (!state.supabase) return;
  const email = $('#loginEmail').value.trim() || window.prompt('Masukkan email akaun:');
  if (!email) return;
  const { error } = await state.supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
  toast(error ? error.message : 'Link reset password telah dihantar ke email.', error ? 'error' : 'success');
}

function showPublic() {
  state.profile = null; state.session = null;
  $('#publicApp').classList.remove('hidden');
  $('#portalApp').classList.add('hidden');
  $('#publicNav').classList.remove('hidden');
  $('#appNav').classList.add('hidden');
}

async function enterPortal() {
  if (!state.session || !state.supabase) return;
  const { data: profile, error } = await state.supabase.from('profiles').select('public_id,full_name,phone,role,status').eq('id', state.session.user.id).single();
  if (error || !profile || profile.status !== 'active') {
    if (profile?.status !== 'active') toast(`Akaun ${profile.status}.`, 'error');
    await state.supabase.auth.signOut(); return;
  }
  state.profile = profile;
  $('#publicApp').classList.add('hidden');
  $('#portalApp').classList.remove('hidden');
  $('#publicNav').classList.add('hidden');
  $('#appNav').classList.remove('hidden');
  $('#navIdentity').textContent = `${profile.public_id} • ${profile.full_name}`;
  $('#sidebarRole').textContent = profile.role === 'admin' ? 'Admin Portal' : profile.role === 'agent' ? 'Ejen Portal' : 'Rider Portal';
  $('#mobileRoleTitle').textContent = $('#sidebarRole').textContent;
  buildMenu();
  state.currentView = 'dashboard';
  await renderView('dashboard');
}

function buildMenu() {
  const admin = [
    ['dashboard','▦','Dashboard'],['members','♟','Rider / Ejen'],['stock','▣','Stok Air'],['flavours','●','Perisa & Harga'],['materials','◫','Bahan & Costing'],['purchases','🛒','Belian Stok'],['expenses','−','Expenses'],['sales','＋','Jualan'],['invoices','▤','Invoices'],['accounting','◒','Accounting'],['partners','◎','Partner Profit'],['posters','▧','Poster'],['audit','↺','Audit Log']
  ];
  const user = [
    ['dashboard','▦','Dashboard'],['new-sale','＋','Update Jualan'],['history','▤','Sales History'],['my-stock','▣','Stok Saya'],['commission','RM','Upah / Komisen'],['directory','◎','Stok Public'],['profile','♟','Profil']
  ];
  const items = state.profile.role === 'admin' ? admin : user;
  $('#sideMenu').innerHTML = items.map(([id,icon,label]) => `<button data-view="${id}" class="${id==='dashboard'?'active':''}"><span>${icon}</span>${label}</button>`).join('');
}

async function renderView(view) {
  $$('#sideMenu button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  const root = $('#portalContent');
  root.innerHTML = `<div class="panel empty-state">Memuatkan...</div>`;
  try {
    if (state.profile.role === 'admin') return await renderAdmin(view, root);
    return await renderUser(view, root);
  } catch (e) {
    console.error(e);
    root.innerHTML = `<div class="panel empty-state"><strong>Ralat</strong><br>${esc(e.message || 'Tidak dapat memuatkan data.')}</div>`;
  }
}

function pageHead(kicker, title, desc, action='') {
  return `<div class="page-head"><div><span class="eyebrow">${esc(kicker)}</span><h1>${esc(title)}</h1><p>${esc(desc)}</p></div>${action}</div>`;
}
function kpi(label, value, note='') { return `<article class="kpi"><div class="label">${esc(label)}</div><div class="value">${value}</div>${note?`<div class="note">${esc(note)}</div>`:''}</article>`; }
function tableEmpty(cols, text='Tiada rekod.') { return `<tr><td colspan="${cols}" class="empty-state">${esc(text)}</td></tr>`; }
