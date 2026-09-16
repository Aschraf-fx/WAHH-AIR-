(function(){
  const PRESET_MESSAGE = `Hi Admin WAHH AIR! Saya berminat dengan tempahan Event / Wedding Supply 100ml.\n\nJenis majlis:\n\nTarikh majlis:\n\nLokasi majlis:\n\nKuantiti botol:\n\nBoleh saya semak ketersediaan dan jumlah harga termasuk penghantaran?`;

  function normalizeWhatsAppNumber(raw='') {
    let digits = String(raw).replace(/\D/g,'');
    if (!digits) return '';
    if (digits.startsWith('0')) digits = `60${digits.slice(1)}`;
    if (!digits.startsWith('60') && digits.length >= 9 && digits.length <= 11) digits = `60${digits}`;
    return digits;
  }

  function applyContact(phone){
    const card = document.getElementById('eventSupplyPoster');
    const note = document.getElementById('eventSupplyContactNote');
    if (!card) return;
    const number = normalizeWhatsAppNumber(phone);
    if (!number) {
      card.href = '#';
      card.removeAttribute('target');
      card.removeAttribute('rel');
      card.classList.add('is-disabled');
      card.setAttribute('aria-disabled','true');
      card.addEventListener('click', e => e.preventDefault(), { once:true });
      if (note) note.textContent = 'Maklumat WhatsApp admin belum tersedia. Sila cuba lagi kemudian.';
      return;
    }
    const href = `https://wa.me/${number}?text=${encodeURIComponent(PRESET_MESSAGE)}`;
    card.href = href;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.classList.remove('is-disabled');
    card.removeAttribute('aria-disabled');
    if (note) note.textContent = 'Klik mana-mana bahagian poster untuk terus WhatsApp Admin WAHH AIR.';
  }

  async function loadAdminContact(){
    try {
      const res = await fetch('/api/config', { cache:'no-store' });
      if (!res.ok) throw new Error('Config tidak tersedia');
      const cfg = await res.json();
      if (!cfg.supabaseUrl || !cfg.supabaseAnonKey) throw new Error('Supabase config tidak lengkap');
      const client = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth:{ persistSession:false, autoRefreshToken:false } });
      const { data, error } = await client.rpc('get_public_admin_contact');
      if (error) throw error;
      const row = Array.isArray(data) ? data[0] : data;
      applyContact(row?.phone || '');
    } catch (err) {
      console.warn('Event supply admin contact unavailable:', err);
      applyContact('');
    }
  }

  document.addEventListener('DOMContentLoaded', loadAdminContact);
})();
