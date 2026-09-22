/* Admin Rider profile review only. Keeps existing member/account actions intact. */
async function adminMembers(root){
  const {data,error}=await state.supabase.rpc('admin_list_members');if(error)throw error;
  root.innerHTML=pageHead('ADMIN','Rider / Ejen','Admin melihat Public ID dan maklumat operasi, bukan Auth UUID atau password.')+`<section class="panel"><div class="table-wrap"><table class="data-table"><thead><tr><th>Public ID</th><th>Nama</th><th>Telefon</th><th>Role</th><th>Status</th><th>Daftar</th><th>Tindakan</th></tr></thead><tbody>${data?.length?data.map(r=>`<tr><td><strong>${esc(r.public_id)}</strong></td><td>${esc(r.full_name)}</td><td>${esc(r.phone||'-')}</td><td><span class="role-badge">${esc(r.role)}</span></td><td><span class="status-badge ${esc(r.status)}">${esc(r.status)}</span></td><td>${dateMY(r.created_at)}</td><td><div class="row-actions" style="margin:0;justify-content:flex-start;flex-wrap:wrap">${r.role==='rider'?`<button class="btn sm soft rider-profile-view" data-id="${esc(r.public_id)}">Lihat Profil Rider</button>`:''}<button class="btn sm ghost member-status" data-id="${esc(r.public_id)}" data-status="${r.status==='active'?'suspended':'active'}">${r.status==='active'?'Suspend':'Aktifkan'}</button><button class="btn sm danger member-delete" data-id="${esc(r.public_id)}">Delete</button></div></td></tr>`).join(''):tableEmpty(7)}</tbody></table></div></section>`;
  $$('.rider-profile-view',root).forEach(b=>b.addEventListener('click',()=>openRiderProfileReview(b.dataset.id)));
  $$('.member-status',root).forEach(b=>b.addEventListener('click',()=>updateMemberStatus(b.dataset.id,b.dataset.status)));
  $$('.member-delete',root).forEach(b=>b.addEventListener('click',()=>deleteMember(b.dataset.id)));
}

async function openRiderProfileReview(publicId){
  let modal=$('#riderProfileReviewModal');
  if(!modal){
    modal=document.createElement('div');
    modal.id='riderProfileReviewModal';
    modal.className='modal hidden';
    modal.setAttribute('role','dialog');
    modal.setAttribute('aria-modal','true');
    modal.innerHTML=`<div class="modal-card" style="width:min(760px,100%)"><button class="modal-close" type="button" aria-label="Tutup">×</button><div id="riderProfileReviewBody"></div></div>`;
    document.body.appendChild(modal);
    $('.modal-close',modal).addEventListener('click',()=>modal.classList.add('hidden'));
    modal.addEventListener('click',e=>{if(e.target===modal)modal.classList.add('hidden');});
  }

  const body=$('#riderProfileReviewBody',modal);
  body.innerHTML='<div class="empty-state">Memuatkan profil Rider...</div>';
  modal.classList.remove('hidden');

  const {data,error}=await state.supabase.rpc('admin_get_rider_profile',{p_public_id:publicId});
  if(error){body.innerHTML=`<div class="empty-state"><strong>Ralat</strong><br>${esc(error.message)}</div>`;return;}
  const profile=Array.isArray(data)?data[0]:data;
  if(!profile){body.innerHTML='<div class="empty-state">Profil Rider tidak ditemui.</div>';return;}
  if(!profile.ic_number || !profile.profile_photo_path || !profile.terms_text){body.innerHTML='<div class="empty-state"><strong>Belum lengkap</strong><br>Rider ini belum mempunyai rekod IC, gambar formal atau T&C.</div>';return;}

  let photoUrl='';
  const {data:signed,error:se}=await state.supabase.storage.from('rider-profiles').createSignedUrl(profile.profile_photo_path,300);
  if(!se) photoUrl=signed?.signedUrl||'';

  body.innerHTML=`
    <div class="page-head" style="margin-bottom:14px"><div><span class="eyebrow">SEMAKAN RIDER</span><h1 style="font-size:1.7rem">${esc(profile.full_name)}</h1><p>${esc(profile.public_id)} • ${esc(profile.phone||'-')}</p></div></div>
    <div class="grid-2">
      <section class="panel" style="margin-top:0">
        <div class="panel-head"><div><h3>Gambar Formal</h3><p>Untuk cross-check identiti Rider.</p></div></div>
        ${photoUrl?`<img src="${esc(photoUrl)}" alt="Gambar formal ${esc(profile.full_name)}" style="width:100%;max-height:420px;object-fit:contain;border:1px solid var(--line);border-radius:14px;background:#f8fafc">`:'<div class="empty-state">Gambar tidak dapat dimuatkan.</div>'}
      </section>
      <section class="panel" style="margin-top:0">
        <div class="panel-head"><div><h3>Maklumat Peribadi</h3><p>Maklumat ini private dan untuk semakan Admin sahaja.</p></div></div>
        <div class="quick-card"><strong>Nama penuh</strong><span>${esc(profile.full_name)}</span></div>
        <div class="quick-card" style="margin-top:10px"><strong>No. IC</strong><span>${esc(profile.ic_number)}</span></div>
        <div class="quick-card" style="margin-top:10px"><strong>No. telefon</strong><span>${esc(profile.phone||'-')}</span></div>
        <div class="quick-card" style="margin-top:10px"><strong>Status akaun</strong><span>${esc(profile.status||'-')}</span></div>
        <div class="quick-card" style="margin-top:10px"><strong>T&C diterima</strong><span>${dateMY(profile.terms_accepted_at)}</span></div>
      </section>
    </div>
    <section class="panel"><div class="panel-head"><div><h3>Pengakuan Rider</h3><p>Salinan T&C yang dipersetujui semasa pendaftaran.</p></div></div><div class="quick-card" style="white-space:pre-wrap;line-height:1.65">${esc(profile.terms_text)}</div></section>`;
}
