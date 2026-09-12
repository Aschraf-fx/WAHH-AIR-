(function(){
  let loading=false;
  let timer=null;

  function esc(v=''){
    return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  }

  function fmtDate(v){
    if(!v)return '-';
    try{return new Intl.DateTimeFormat('ms-MY',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));}
    catch{return String(v);}
  }

  function findTikTokPanel(){
    return Array.from(document.querySelectorAll('section.panel')).find(s=>{
      const h=s.querySelector('h3');
      return h&&h.textContent.includes('TikTok Connection');
    });
  }

  async function getToken(forceRefresh=false){
    if(!state?.supabase)throw new Error('Supabase belum tersedia.');
    if(forceRefresh){
      const {data,error}=await state.supabase.auth.refreshSession();
      if(error)throw error;
      if(data?.session)state.session=data.session;
      return data?.session?.access_token||'';
    }
    const {data,error}=await state.supabase.auth.getSession();
    if(error)throw error;
    if(data?.session)state.session=data.session;
    return data?.session?.access_token||'';
  }

  async function api(forceRefresh=false){
    const token=await getToken(forceRefresh);
    if(!token)throw new Error('Session login tiada.');
    const r=await fetch('/api/tiktok-history',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:'{}'});
    const data=await r.json().catch(()=>({}));
    if(r.status===401&&!forceRefresh)return api(true);
    if(!r.ok)throw new Error(data.error||`HTTP ${r.status}`);
    return data;
  }

  function statusBadge(status){
    const raw=String(status||'unknown').toLowerCase();
    const cls=['posted','scheduled','failed'].includes(raw)?raw:'other';
    const label=raw==='posted'?'PUBLISH COMPLETE':raw==='scheduled'?'PROCESSING':raw==='failed'?'FAILED':raw.toUpperCase();
    return `<span class="tiktok-history-status ${cls}">${esc(label)}</span>`;
  }

  function resultCard(post){
    if(!post)return '<div class="tiktok-history-empty muted">Belum ada TikTok post direkodkan.</div>';
    const log=post.latest_log||{};
    const provider=log.provider_response||{};
    const providerStatus=provider.status||'';
    const shownStatus=post.status==='posted'?'PUBLISH_COMPLETE':post.status==='failed'?'FAILED':providerStatus||'PROCESSING';
    return `<div class="tiktok-latest-card">
      <div class="tiktok-latest-top">
        <div>
          <h4 class="tiktok-latest-title">Latest Post Result</h4>
          <p class="tiktok-latest-caption">${esc(post.caption||'-')}</p>
        </div>
        ${statusBadge(post.status)}
      </div>
      <div class="tiktok-meta-grid">
        <div class="tiktok-meta-label">TikTok status</div><div class="tiktok-meta-value"><strong>${esc(shownStatus)}</strong></div>
        <div class="tiktok-meta-label">Publish ID</div><div class="tiktok-meta-value">${esc(post.external_post_id||'-')}</div>
        <div class="tiktok-meta-label">Created</div><div class="tiktok-meta-value">${esc(fmtDate(post.created_at))}</div>
        <div class="tiktok-meta-label">Published</div><div class="tiktok-meta-value">${esc(fmtDate(post.posted_at))}</div>
        <div class="tiktok-meta-label">Error</div><div class="tiktok-meta-value">${esc(post.error_message||log.error_message||'-')}</div>
      </div>
    </div>`;
  }

  function rows(posts){
    if(!posts?.length)return '<tr><td colspan="5" class="tiktok-history-empty muted">Belum ada TikTok Post History.</td></tr>';
    return posts.map(p=>`<tr>
      <td>${esc(fmtDate(p.created_at))}</td>
      <td>${statusBadge(p.status)}</td>
      <td>${esc(p.caption||'-')}</td>
      <td>${esc(p.external_post_id||'-')}</td>
      <td>${esc(p.posted_at?fmtDate(p.posted_at):'-')}</td>
    </tr>`).join('');
  }

  function ensurePanel(){
    const tiktok=findTikTokPanel();
    if(!tiktok)return null;
    let panel=document.querySelector('#tiktokPostHistoryPanel');
    if(panel&&panel.previousElementSibling!==tiktok){panel.remove();panel=null;}
    if(!panel){
      panel=document.createElement('section');
      panel.id='tiktokPostHistoryPanel';
      panel.className='panel tiktok-history-panel';
      panel.innerHTML='<div class="muted">Loading TikTok Post History...</div>';
      tiktok.insertAdjacentElement('afterend',panel);
    }
    return panel;
  }

  async function renderHistory(){
    const panel=ensurePanel();
    if(!panel||loading)return;
    loading=true;
    try{
      const data=await api(false);
      const s=data.summary||{};
      panel.innerHTML=`
        <div class="tiktok-history-head">
          <div><h3>🎵 TikTok Post History</h3><p class="muted">Rekod Direct Post, publish ID dan status TikTok untuk semakan owner.</p></div>
          <button class="btn sm ghost" id="tiktokHistoryRefresh" type="button">Refresh Status</button>
        </div>
        <div class="tiktok-history-summary">
          <div class="tiktok-history-stat"><strong>${Number(s.total||0)}</strong><span class="muted">Recent posts</span></div>
          <div class="tiktok-history-stat"><strong>${Number(s.posted||0)}</strong><span class="muted">Publish complete</span></div>
          <div class="tiktok-history-stat"><strong>${Number(s.processing||0)}</strong><span class="muted">Processing</span></div>
          <div class="tiktok-history-stat"><strong>${Number(s.failed||0)}</strong><span class="muted">Failed</span></div>
        </div>
        ${resultCard(data.latest)}
        <div class="tiktok-history-table-wrap">
          <table class="tiktok-history-table">
            <thead><tr><th>Masa</th><th>Status</th><th>Caption</th><th>Publish ID</th><th>Published</th></tr></thead>
            <tbody>${rows(data.posts||[])}</tbody>
          </table>
        </div>`;
      const refresh=panel.querySelector('#tiktokHistoryRefresh');
      if(refresh)refresh.onclick=()=>renderHistory();
    }catch(e){
      panel.innerHTML=`<div class="tiktok-history-head"><div><h3>🎵 TikTok Post History</h3><p class="profit-negative">${esc(e.message)}</p></div><button class="btn sm ghost" id="tiktokHistoryRefresh" type="button">Cuba Lagi</button></div>`;
      const refresh=panel.querySelector('#tiktokHistoryRefresh');
      if(refresh)refresh.onclick=()=>renderHistory();
    }finally{
      loading=false;
    }
  }

  function schedule(){
    if(timer)return;
    timer=setInterval(()=>{
      if(findTikTokPanel())renderHistory();
    },12000);
  }

  const observer=new MutationObserver(()=>{
    if(findTikTokPanel())renderHistory();
  });
  observer.observe(document.documentElement,{childList:true,subtree:true});
  document.addEventListener('DOMContentLoaded',()=>{renderHistory();schedule();});
  setTimeout(()=>{renderHistory();schedule();},1200);
})();
