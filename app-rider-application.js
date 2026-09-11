/* Rider-only registration verification. Agent registration remains unchanged. */
(function(){
  const TNC_TEMPLATE = (name) => `Saya, ${name || '[Nama Rider]'}, mengesahkan dan bersetuju bahawa semua botol WAHH AIR yang saya ambil akan dijual sepenuhnya dan saya akan menyerahkan hasil jualan yang sepatutnya kepada owner tanpa penipuan, pecah amanah atau tindakan tidak amanah. Saya memahami bahawa maklumat identiti dan gambar formal saya dikumpulkan untuk tujuan pengesahan, rekod dan pengurusan sebarang salah laku atau tuntutan yang sah mengikut undang-undang yang berkuat kuasa.`;

  function injectRiderFields(){
    const form = document.getElementById('registerForm');
    const submit = form?.querySelector('button[type="submit"]');
    if (!form || !submit || document.getElementById('riderApplicationFields')) return;

    const wrap = document.createElement('div');
    wrap.id = 'riderApplicationFields';
    wrap.className = 'rider-application-box hidden';
    wrap.innerHTML = `
      <h3>Pengesahan Rider & T&C</h3>
      <p class="rider-note">Bahagian ini wajib untuk permohonan Rider sahaja.</p>
      <label>No. IC Rider
        <input id="registerIc" type="text" inputmode="numeric" maxlength="14" autocomplete="off" placeholder="Contoh: 010203101234">
      </label>
      <label>Gambar formal Rider
        <input id="registerRiderPhoto" type="file" accept="image/jpeg,image/png,image/webp">
      </label>
      <p class="rider-note">Gunakan gambar formal dengan wajah yang jelas. Format JPG, PNG atau WEBP, maksimum 5MB.</p>
      <div class="rider-sensitive"><strong>Privasi:</strong><span>No. IC dan gambar formal disimpan sebagai rekod peribadi dan bukan untuk paparan public.</span></div>
      <div id="riderTncText" class="rider-tnc"></div>
      <label class="rider-consent">
        <input id="registerRiderTnc" type="checkbox">
        <span>Saya telah membaca, memahami dan bersetuju dengan T&C Rider di atas serta tujuan pengumpulan maklumat identiti saya.</span>
      </label>`;
    form.insertBefore(wrap, submit);

    const name = document.getElementById('registerName');
    name?.addEventListener('input', updateTncText);
    document.getElementById('registerRole')?.addEventListener('change', syncRiderFields);
    updateTncText();
    syncRiderFields();
  }

  function updateTncText(){
    const box = document.getElementById('riderTncText');
    const name = document.getElementById('registerName')?.value.trim();
    if (!box) return;
    const text = TNC_TEMPLATE(name);
    box.innerHTML = `<p>${typeof esc === 'function' ? esc(text) : text}</p>`;
  }

  function syncRiderFields(){
    const isRider = document.getElementById('registerRole')?.value === 'rider';
    const wrap = document.getElementById('riderApplicationFields');
    if (!wrap) return;
    wrap.classList.toggle('hidden', !isRider);
    ['registerIc','registerRiderPhoto','registerRiderTnc'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.required = !!isRider;
    });
  }

  async function cleanupPendingPhoto(path){
    if (!path) return;
    try { await fetch('/api/rider-profile-upload',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({path})}); } catch (_) {}
  }

  async function uploadRiderPhoto(file){
    const req = await fetch('/api/rider-profile-upload',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({contentType:file.type})
    });
    const out = await req.json().catch(()=>({}));
    if (!req.ok || !out.path || !out.token) throw new Error(out.error || 'Tidak dapat menyediakan upload gambar Rider.');

    const { error } = await state.supabase.storage.from('rider-profiles').uploadToSignedUrl(out.path,out.token,file,{contentType:file.type});
    if (error) throw error;
    return out.path;
  }

  // Replace only the registration handler. Login and every other app flow remain untouched.
  register = async function(e){
    e.preventDefault();
    if (!state.supabase) return toast('Supabase belum disambungkan.', 'error');

    const btn = e.submitter;
    const role = document.getElementById('registerRole').value;
    const name = document.getElementById('registerName').value.trim();
    let uploadedPath = '';
    const metadata = {
      full_name:name,
      phone:document.getElementById('registerPhone').value.trim(),
      role
    };

    if (role === 'rider') {
      const ic = document.getElementById('registerIc')?.value.replace(/\D/g,'') || '';
      const photo = document.getElementById('registerRiderPhoto')?.files?.[0];
      const accepted = !!document.getElementById('registerRiderTnc')?.checked;

      if (ic.length !== 12) return toast('No. IC Rider mesti mengandungi 12 digit.', 'error');
      if (!photo) return toast('Sila pilih gambar formal Rider.', 'error');
      if (!['image/jpeg','image/png','image/webp'].includes(photo.type)) return toast('Gambar mesti dalam format JPG, PNG atau WEBP.', 'error');
      if (photo.size > 5 * 1024 * 1024) return toast('Saiz gambar Rider mesti 5MB atau kurang.', 'error');
      if (!accepted) return toast('Sila baca dan setuju dengan T&C Rider sebelum mendaftar.', 'error');

      setBusy(btn,true,'Memuat naik gambar...');
      try {
        uploadedPath = await uploadRiderPhoto(photo);
      } catch (err) {
        setBusy(btn,false);
        return toast(err.message || 'Upload gambar Rider gagal.', 'error');
      }

      metadata.ic_number = ic;
      metadata.profile_photo_path = uploadedPath;
      metadata.rider_terms_accepted = 'true';
      metadata.rider_terms_text = TNC_TEMPLATE(name);
    } else {
      setBusy(btn,true,'Mendaftar...');
    }

    if (role === 'rider') setBusy(btn,true,'Mendaftar...');
    const payload = {
      email:document.getElementById('registerEmail').value.trim(),
      password:document.getElementById('registerPassword').value,
      options:{ data:metadata }
    };

    const { data, error } = await state.supabase.auth.signUp(payload);
    setBusy(btn,false);
    if (error) {
      await cleanupPendingPhoto(uploadedPath);
      return toast(error.message, 'error');
    }

    closeModal('registerModal');
    document.getElementById('registerForm').reset();
    syncRiderFields();
    toast(data.session ? 'Akaun berjaya didaftarkan.' : 'Pendaftaran berjaya. Semak email untuk pengesahan.', 'success');
  };

  document.addEventListener('DOMContentLoaded', () => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = '/rider-application.css';
    document.head.appendChild(link);
    injectRiderFields();
    setTimeout(syncRiderFields,0);
  });
})();
