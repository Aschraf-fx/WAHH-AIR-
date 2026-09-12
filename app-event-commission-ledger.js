(function(){
  const previousRenderAdmin=window.renderAdmin;

  window.renderAdmin=async function(view,root){
    const result=await previousRenderAdmin(view,root);
    if(view==='events'&&state.profile?.role==='admin') await appendEventCommissionLedger(root);
    return result;
  };

  async function appendEventCommissionLedger(root){
    const {data,error}=await state.supabase.rpc('admin_event_commission_ledger');
    if(error){
      console.warn('Event commission ledger unavailable:',error);
      return;
    }
    const rows=data||[];
    const total=rows.reduce((a,x)=>a+Number(x.amount||0),0);
    const paid=rows.filter(x=>x.status==='paid').reduce((a,x)=>a+Number(x.amount||0),0);
    const pending=total-paid;

    const section=document.createElement('section');
    section.className='panel';
    section.innerHTML=`
      <div class="panel-head">
        <div>
          <h3>Komisen Event / PIC Event</h3>
          <p>Ringkasan siapa menerima komisen, event berkaitan dan orang yang boleh dihubungi untuk event tersebut.</p>
        </div>
      </div>
      <div class="kpi-grid">
        ${kpi('Jumlah Komisen',money(total))}
        ${kpi('Sudah Dibayar',money(paid))}
        ${kpi('Belum Dibayar',money(pending))}
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Penerima Komisen</th>
            <th>Event / Majlis</th>
            <th>PIC / Nama Orang Event</th>
            <th>No. Telefon</th>
            <th class="num">Kadar / Botol</th>
            <th class="num">Qty</th>
            <th class="num">Jumlah Komisen</th>
            <th>Status</th>
            <th>Tarikh Dibayar</th>
            <th>Catatan</th>
          </tr></thead>
          <tbody>
            ${rows.length?rows.map(r=>`<tr>
              <td><strong>${esc(r.recipient_name)}</strong></td>
              <td><strong>${esc(r.event_name)}</strong><br><span class="muted">${esc(r.event_date||'')}</span></td>
              <td>${esc(r.contact_name||'-')}</td>
              <td>${esc(r.contact_phone||'-')}</td>
              <td class="num">${money(r.rate_per_bottle)}</td>
              <td class="num">${num(r.quantity)}</td>
              <td class="num"><strong>${money(r.amount)}</strong></td>
              <td>${r.status==='paid'?'Sudah dibayar':'Belum dibayar'}</td>
              <td>${r.paid_at?dateMY(r.paid_at):'-'}</td>
              <td>${esc(r.notes||'-')}</td>
            </tr>`).join(''):tableEmpty(10,'Belum ada rekod komisen event.')}
          </tbody>
        </table>
      </div>`;
    root.appendChild(section);
  }
})();
