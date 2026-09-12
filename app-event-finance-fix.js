(function(){
  const previousRenderAdmin=window.renderAdmin;

  window.renderAdmin=async function(view,root){
    const result=await previousRenderAdmin(view,root);
    if(view==='dashboard'&&state.profile?.role==='admin') await appendCombinedBusinessSummary(root);
    setTimeout(()=>applySimpleEventUi(root),0);
    return result;
  };

  async function appendCombinedBusinessSummary(root){
    const {data,error}=await state.supabase.rpc('admin_business_dashboard_summary');
    if(error){
      console.warn('Combined event dashboard unavailable:',error);
      return;
    }
    const s=data?.[0]||{};
    const section=document.createElement('section');
    section.className='panel';
    section.innerHTML=`
      <div class="panel-head">
        <div>
          <h3>Jumlah Bisnes — Rider/Ejen + Event</h3>
          <p>Event hanya dikira selepas status Completed. Pending, Confirmed dan Cancelled tidak masuk revenue sebenar.</p>
        </div>
      </div>
      <div class="kpi-grid">
        ${kpi('Hari Ini • Rider/Ejen',money(s.today_member_sales))}
        ${kpi('Hari Ini • Event Completed',money(s.today_event_sales))}
        ${kpi('Hari Ini • Total Bisnes',money(s.today_total_sales))}
        ${kpi('Bulan Ini • Rider/Ejen',money(s.month_member_sales))}
        ${kpi('Bulan Ini • Event Completed',money(s.month_event_sales))}
        ${kpi('Bulan Ini • Total Bisnes',money(s.month_total_sales))}
        ${kpi('Untung Event Bulan Ini',money(s.month_event_net_profit))}
        ${kpi('Net Profit Bisnes Bulan Ini',money(s.month_combined_net_profit))}
      </div>`;
    root.appendChild(section);
  }

  function setKpi(root,label,value){
    $$('.kpi',root).forEach(card=>{
      const l=$('.label',card)?.textContent?.trim();
      if(l===label){
        const v=$('.value',card);
        if(v)v.innerHTML=value;
      }
    });
  }

  function applySimpleEventUi(root=document){
    const createMode=$('#evCostMode',root);
    if(createMode){
      createMode.innerHTML='<option value="combined">Kos produk / botol</option>';
      createMode.value='combined';
      createMode.disabled=true;
      const base=$('#evBaseCost',root); if(base)base.disabled=false;
      const label=createMode.closest('label'); if(label)label.childNodes[0].textContent='Kaedah kos ';
      const baseLabel=base?.closest('label'); if(baseLabel)baseLabel.childNodes[0].textContent='Kos produk / botol (RM) ';
    }

    const editMode=$('#edCostMode',root);
    if(editMode){
      editMode.innerHTML='<option value="combined">Kos produk / botol</option>';
      editMode.value='combined';
      editMode.disabled=true;
      const base=$('#edBaseCost',root); if(base)base.disabled=false;
      const label=editMode.closest('label'); if(label)label.childNodes[0].textContent='Kaedah kos ';
      const baseLabel=base?.closest('label'); if(baseLabel)baseLabel.childNodes[0].textContent='Kos produk / botol (RM) ';
    }

    const stockForm=$('#eventStockForm',root);
    if(stockForm){
      const section=stockForm.closest('section');
      if(section)section.style.display='none';
    }

    const status=$('#edStatus',root)?.value;
    if(status==='cancelled'){
      setKpi(root,'Jualan Minuman',money(0));
      setKpi(root,'Delivery Pelanggan',money(0));
      setKpi(root,'Jumlah Pendapatan',money(0));
      setKpi(root,'Baki Pelanggan',money(0));
      setKpi(root,'Untung Bersih',money(0));
      setKpi(root,'Kerugian',money(0));

      const head=$('.page-head',root);
      if(head&&!root.querySelector('.event-cancelled-notice')){
        const note=document.createElement('div');
        note.className='panel event-cancelled-notice';
        note.innerHTML='<strong>Event Cancelled</strong><br><span class="muted">Jualan, revenue dan untung event ini tidak dikira. Bayaran pelanggan yang pernah diterima masih dipaparkan untuk rujukan/refund.</span>';
        head.insertAdjacentElement('afterend',note);
      }

      $$('section.panel .muted',root).forEach(el=>{
        if(el.textContent.includes('Untung boleh diagih')) el.textContent='Untung boleh diagih RM0.00 • Event cancelled';
      });
    }
  }

  document.addEventListener('submit',e=>{
    if(e.target?.id==='eventCreateForm'){
      const mode=$('#evCostMode'); const base=$('#evBaseCost');
      if(mode){mode.disabled=false;mode.value='combined';}
      if(base)base.disabled=false;
    }
    if(e.target?.id==='eventEditForm'){
      const mode=$('#edCostMode'); const base=$('#edBaseCost');
      if(mode){mode.disabled=false;mode.value='combined';}
      if(base)base.disabled=false;
    }
  },true);

  const observer=new MutationObserver(()=>{
    const root=$('#portalContent');
    if(root)applySimpleEventUi(root);
  });
  const portal=$('#portalContent');
  if(portal)observer.observe(portal,{childList:true,subtree:true});
})();
