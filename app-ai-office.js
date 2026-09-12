(function(){
  const statusLabel={standby:'STANDBY',queued:'QUEUED',working:'WORKING',waiting_approval:'WAITING APPROVAL',completed:'COMPLETED',failed:'FAILED',cancelled:'CANCELLED'};
  const icon={chief:'🧠',marketing:'📣',accounting:'📊'};
  const oldBuildMenu=window.buildMenu;
  window.buildMenu=function(){
    oldBuildMenu();
    if(state.profile?.role!=='admin')return;
    const m=$('#sideMenu');
    if(m&&!m.querySelector('[data-view="ai-office"]')){
      const b=document.createElement('button');b.dataset.view='ai-office';b.innerHTML='<span>🤖</span>AI Office';m.appendChild(b);
    }
  };
  const previousRenderAdmin=window.renderAdmin;
  window.renderAdmin=async function(view,root){
    if(view==='ai-office')return renderAiOffice(root);
    return previousRenderAdmin(view,root);
  };

  async function overview(){
    const {data,error}=await state.supabase.rpc('admin_ai_office_overview');
    if(error)throw error;
    if(!data)throw new Error('AI Office hanya untuk Admin.');
    return data;
  }

  async function renderAiOffice(root){
    const o=await overview(),agents=o.agents||[],tasks=o.recent_tasks||[],usage=o.month_usage||{};
    root.innerHTML=pageHead('ADMIN • AI OFFICE','WAHH AIR AI Staff','Owner → Chief AI → Marketing / Accounting. Agent hanya bekerja bila ada task.')+`
      <section class="ai-office-command panel">
        <div class="panel-head"><div><h3>Owner Command</h3><p>Beri arahan kepada Chief atau terus kepada department tertentu.</p></div></div>
        <form id="aiCommandForm" class="form-stack">
          <label>Hantar kepada<select id="aiTarget"><option value="chief">Chief AI</option><option value="marketing">Marketing AI</option><option value="accounting">Accounting AI</option></select></label>
          <label>Arahan<textarea id="aiInstruction" rows="4" placeholder="Contoh: Chief, buat kempen wedding untuk bulan ini." required></textarea></label>
          <div class="row-actions"><button class="btn primary" type="submit">Hantar Task</button><button class="btn ghost" id="aiRefresh" type="button">Refresh</button></div>
        </form>
      </section>
      <div class="kpi-grid">${kpi('Active Projects',num(o.active_projects))}${kpi('Tasks in Queue',num(o.queued))}${kpi('Needs Your Attention',num(o.waiting_approval))}${kpi('Agents at Work',num(o.working))}${kpi('Completed Today',num(o.completed_today))}${kpi('AI Usage Bulan Ini',`${num(Number(usage.input_tokens||0)+Number(usage.output_tokens||0))} token`,`${moneyCny(usage.estimated_cost)} reported/estimated`)}</div>
      <section class="panel"><div class="panel-head"><div><h3>AI Staff</h3><p>Model boleh ditukar tanpa ubah logic agent. API key kekal server-side.</p></div></div><div class="ai-agent-grid">${agents.map(agentCard).join('')}</div></section>
      <section class="panel"><div class="panel-head"><div><h3>Task History</h3><p>Task gagal tidak hilang. Marketing output menunggu approval owner.</p></div></div>${taskTable(tasks)}</section>`;

    $('#aiCommandForm',root).addEventListener('submit',async e=>{e.preventDefault();const b=e.submitter;setBusy(b,true,'AI sedang bekerja...');try{const r=await callApi({action:'command',agent:$('#aiTarget',root).value,instruction:$('#aiInstruction',root).value.trim()});toast('Task selesai diproses.','success');if(r.result)showResultModal(r);await renderAiOffice(root);}catch(err){toast(err.message,'error');await renderAiOffice(root);}finally{setBusy(b,false);}});
    $('#aiRefresh',root).onclick=()=>renderAiOffice(root);
    $$('.ai-save-agent',root).forEach(b=>b.onclick=async()=>{const card=b.closest('.ai-agent-card'),code=card.dataset.code,model=$('.ai-model',card).value.trim(),budget=$('.ai-budget',card).value;const{error}=await state.supabase.rpc('admin_ai_update_agent',{p_code:code,p_model_name:model,p_monthly_budget:budget===''?null:Number(budget)});if(error)return toast(error.message,'error');toast(`${code.toUpperCase()} config disimpan.`,'success');renderAiOffice(root);});
    $$('.ai-test-agent',root).forEach(b=>b.onclick=async()=>{const code=b.closest('.ai-agent-card').dataset.code;setBusy(b,true,'Testing...');try{const r=await callApi({action:'test',agent:code});toast(`${code.toUpperCase()}: ${r.response}`,'success');}catch(e){toast(e.message,'error');}finally{setBusy(b,false);}});
    $$('.ai-approve',root).forEach(b=>b.onclick=()=>setApproval(root,b.dataset.id,'approved'));
    $$('.ai-reject',root).forEach(b=>b.onclick=async()=>{const f=window.prompt('Sebab reject:')||'';await setApproval(root,b.dataset.id,'rejected',f);});
    $$('.ai-revise',root).forEach(b=>b.onclick=async()=>{const f=window.prompt('Apa yang perlu direvise?');if(!f)return;await setApproval(root,b.dataset.id,'revision_requested',f);});
    $$('.ai-cancel',root).forEach(b=>b.onclick=async()=>{const ok=await confirmAction('Batalkan task?','Task queued ini akan ditandakan CANCELLED.');if(!ok)return;const{error}=await state.supabase.rpc('admin_ai_cancel_task',{p_task_id:b.dataset.id});if(error)return toast(error.message,'error');toast('Task dibatalkan.','success');renderAiOffice(root);});
    $$('.ai-view-result',root).forEach(b=>b.onclick=()=>{const t=tasks.find(x=>x.id===b.dataset.id);if(t)showResultModal({agent:t.agent_code,result:t.result_summary,task_id:t.id});});
  }

  function agentCard(a){return `<article class="ai-agent-card" data-code="${esc(a.code)}"><div class="ai-agent-top"><div class="ai-agent-avatar">${icon[a.code]||'🤖'}</div><div><h3>${esc(a.display_name)}</h3><span class="ai-status ${esc(a.status)}">${esc(statusLabel[a.status]||a.status)}</span></div></div><p>${esc(a.description||'')}</p><div class="form-stack"><label>Model<input class="ai-model" value="${esc(a.model_name||'')}" placeholder="Masukkan model name dari provider"></label><label>Budget bulanan (CNY)<input class="ai-budget" type="number" min="0" step="0.01" value="${a.monthly_budget==null?'':a.monthly_budget}"></label><div class="row-actions"><button class="btn sm primary ai-save-agent" type="button">Simpan</button><button class="btn sm ghost ai-test-agent" type="button">Test Connection</button></div></div></article>`;}
  function taskTable(rows){return `<div class="table-wrap"><table class="data-table"><thead><tr><th>Masa</th><th>Agent</th><th>Arahan</th><th>Status</th><th>Approval</th><th>Tindakan</th></tr></thead><tbody>${rows.length?rows.map(t=>`<tr><td>${dateMY(t.created_at)}</td><td><strong>${esc(t.agent_name||'-')}</strong></td><td>${esc((t.original_instruction||'').slice(0,180))}</td><td><span class="ai-status ${esc(t.status)}">${esc(statusLabel[t.status]||t.status)}</span>${t.error_message?`<br><span class="profit-negative">${esc(t.error_message)}</span>`:''}</td><td>${esc(t.approval_status||'-')}</td><td><div class="row-actions" style="margin:0;justify-content:flex-start">${t.result_summary?`<button class="btn sm ghost ai-view-result" data-id="${t.id}">Result</button>`:''}${t.status==='waiting_approval'?`<button class="btn sm success ai-approve" data-id="${t.id}">Approve</button><button class="btn sm ghost ai-revise" data-id="${t.id}">Revision</button><button class="btn sm danger ai-reject" data-id="${t.id}">Reject</button>`:''}${t.status==='queued'?`<button class="btn sm danger ai-cancel" data-id="${t.id}">Cancel</button>`:''}</div></td></tr>`).join(''):tableEmpty(6,'Belum ada task AI.')}</tbody></table></div>`;}
  async function callApi(payload){
    const token=state.session?.access_token;if(!token)throw new Error('Session login tiada.');
    const r=await fetch('/api/ai-office',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify(payload)});const data=await r.json().catch(()=>({}));if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);return data;
  }
  async function setApproval(root,id,status,feedback=null){const{error}=await state.supabase.rpc('admin_ai_set_task_approval',{p_task_id:id,p_status:status,p_feedback:feedback});if(error)return toast(error.message,'error');toast(`Task ${status}.`,'success');renderAiOffice(root);}
  function showResultModal(r){
    let box=$('#aiResultModal');if(!box){box=document.createElement('div');box.id='aiResultModal';box.className='modal hidden';box.innerHTML='<div class="modal-card ai-result-card"><div class="modal-head"><h3>AI Result</h3><button class="icon-btn" data-ai-close>×</button></div><div id="aiResultBody"></div></div>';document.body.appendChild(box);box.addEventListener('click',e=>{if(e.target===box||e.target.closest('[data-ai-close]'))box.classList.add('hidden');});}
    $('#aiResultBody',box).innerHTML=`<div class="muted">${esc(String(r.agent||'AI').toUpperCase())} • Task ${esc(r.task_id||'-')}</div><pre class="ai-result-pre">${esc(r.result||'Tiada result.')}</pre>`;box.classList.remove('hidden');
  }
  function moneyCny(v){return `¥${Number(v||0).toFixed(4)}`;}
})();
