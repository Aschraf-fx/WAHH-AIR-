function normalizeWhatsAppNumber(raw='') {
  let digits = String(raw).replace(/\D/g,'');
  if (!digits) return '';
  if (digits.startsWith('0')) digits = `60${digits.slice(1)}`;
  if (!digits.startsWith('60') && digits.length >= 9 && digits.length <= 11) digits = `60${digits}`;
  return digits;
}

function setAdminContact(phone, name='Admin WAHH AIR') {
  const number = normalizeWhatsAppNumber(phone);
  const buttons = [document.getElementById('adminContactBtn'), document.getElementById('adminContactBtnBottom')].filter(Boolean);
  const note = document.getElementById('adminContactNote');

  if (!number) {
    buttons.forEach(btn => { btn.classList.add('is-disabled'); btn.setAttribute('aria-disabled','true'); btn.removeAttribute('target'); btn.href='#'; });
    if (note) note.textContent = 'Maklumat hubungan admin belum tersedia. Sila cuba lagi kemudian.';
    return;
  }

  const message = encodeURIComponent('Hai Admin WAHH AIR, saya berminat untuk tahu lebih lanjut tentang Program Rider WAHH AIR.');
  const href = `https://wa.me/${number}?text=${message}`;
  buttons.forEach(btn => {
    btn.href = href;
    btn.target = '_blank';
    btn.rel = 'noopener noreferrer';
    btn.classList.remove('is-disabled');
    btn.removeAttribute('aria-disabled');
  });
  if (note) note.textContent = `Hubungi ${name} melalui WhatsApp untuk pertanyaan Program Rider.`;
}

async function loadAdminContact() {
  try {
    const res = await fetch('/api/config', { cache:'no-store' });
    if (!res.ok) throw new Error('Config tidak tersedia');
    const cfg = await res.json();
    if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('Supabase config tidak lengkap');
    const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth:{ persistSession:false, autoRefreshToken:false } });
    const { data, error } = await client.rpc('get_public_admin_contact');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    setAdminContact(row?.phone || '', row?.full_name || 'Admin WAHH AIR');
  } catch (err) {
    console.warn('Admin contact unavailable:', err);
    setAdminContact('');
  }
}

document.addEventListener('DOMContentLoaded', loadAdminContact);
