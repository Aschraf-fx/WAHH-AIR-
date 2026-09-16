(function(){
  const GROUPS=[
    {id:'operations',icon:'⚙',label:'Operasi',views:['members','stock','sales','events']},
    {id:'products',icon:'▦',label:'Produk & Inventori',views:['flavours','materials','purchases']},
    {id:'finance',icon:'RM',label:'Kewangan',views:['expenses','invoices','accounting','partners','sales-documents']},
    {id:'content',icon:'▧',label:'Content & Marketing',views:['posters','recruitment-posters','tiktok-history','tiktok-post-history','social-media']},
    {id:'system',icon:'✦',label:'Sistem & AI',views:['ai-office','audit']}
  ];

  const VIEW_TO_GROUP=Object.fromEntries(GROUPS.flatMap(g=>g.views.map(v=>[v,g.id])));

  function injectStyles(){
    if(document.getElementById('sidebarMenuOrganizerStyles'))return;
    const style=document.createElement('style');
    style.id='sidebarMenuOrganizerStyles';
    style.textContent=`
      .side-menu{display:grid;gap:7px;margin-top:14px}
      .side-menu>.menu-dashboard{margin-bottom:2px}
      .menu-group{border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;background:rgba(255,255,255,.025)}
      .side-menu .menu-group-toggle{width:100%;border:0;background:transparent;color:#dce6f8;padding:11px 12px;border-radius:0;text-align:left;font-weight:850;display:flex;align-items:center;gap:10px}
      .side-menu .menu-group-toggle:hover,.side-menu .menu-group-toggle.has-active{background:rgba(255,255,255,.09);color:#fff}
      .menu-group-toggle .menu-group-icon{width:22px;flex:0 0 22px;text-align:center;font-size:.9rem}
      .menu-group-toggle .menu-group-label{flex:1}
      .menu-group-toggle .menu-group-chevron{font-size:.72rem;transition:transform .18s ease;opacity:.75}
      .menu-group.open .menu-group-chevron{transform:rotate(90deg)}
      .menu-group-items{display:none;padding:4px 6px 7px;border-top:1px solid rgba(255,255,255,.06)}
      .menu-group.open .menu-group-items{display:grid;gap:3px}
      .side-menu .menu-group-items button{padding:9px 10px 9px 15px;font-size:.88rem;border-radius:8px;color:#bdcae3}
      .side-menu .menu-group-items button span{width:20px;flex:0 0 20px;text-align:center}
      .side-menu .menu-group-items button.active{background:rgba(255,255,255,.13);color:#fff}
      @media(max-width:820px){
        .side-menu{gap:6px}.menu-group{border-radius:11px}
        .side-menu .menu-group-toggle{padding:10px 11px}
        .side-menu .menu-group-items button{padding:9px 9px 9px 14px}
      }
    `;
    document.head.appendChild(style);
  }

  function remember(groupId){
    try{localStorage.setItem('wahhAdminMenuGroup',groupId||'');}catch(_){ }
  }
  function remembered(){
    try{return localStorage.getItem('wahhAdminMenuGroup')||'';}catch(_){return '';}
  }

  function setOpen(sideMenu,groupId){
    sideMenu.querySelectorAll('.menu-group').forEach(group=>{
      const open=group.dataset.group===groupId;
      group.classList.toggle('open',open);
      const toggle=group.querySelector('.menu-group-toggle');
      if(toggle)toggle.setAttribute('aria-expanded',open?'true':'false');
    });
    remember(groupId);
  }

  function organize(){
    const sideMenu=document.getElementById('sideMenu');
    if(!sideMenu||state.profile?.role!=='admin')return;

    const buttons=[...sideMenu.querySelectorAll(':scope > button[data-view]')];
    if(!buttons.length)return;

    const dashboard=buttons.find(b=>b.dataset.view==='dashboard');
    const byView=new Map(buttons.map(b=>[b.dataset.view,b]));
    sideMenu.innerHTML='';

    if(dashboard){
      dashboard.classList.add('menu-dashboard');
      sideMenu.appendChild(dashboard);
    }

    GROUPS.forEach(group=>{
      const items=group.views.map(v=>byView.get(v)).filter(Boolean);
      if(!items.length)return;
      const wrap=document.createElement('div');
      wrap.className='menu-group';
      wrap.dataset.group=group.id;
      wrap.innerHTML=`<button type="button" class="menu-group-toggle" data-menu-group="${group.id}" aria-expanded="false"><span class="menu-group-icon">${group.icon}</span><span class="menu-group-label">${group.label}</span><span class="menu-group-chevron">▶</span></button><div class="menu-group-items"></div>`;
      const target=wrap.querySelector('.menu-group-items');
      items.forEach(btn=>target.appendChild(btn));
      sideMenu.appendChild(wrap);
    });

    const known=new Set(['dashboard',...GROUPS.flatMap(g=>g.views)]);
    const extra=buttons.filter(b=>!known.has(b.dataset.view));
    if(extra.length){
      const wrap=document.createElement('div');
      wrap.className='menu-group';
      wrap.dataset.group='other';
      wrap.innerHTML='<button type="button" class="menu-group-toggle" data-menu-group="other" aria-expanded="false"><span class="menu-group-icon">•••</span><span class="menu-group-label">Lain-lain</span><span class="menu-group-chevron">▶</span></button><div class="menu-group-items"></div>';
      const target=wrap.querySelector('.menu-group-items');
      extra.forEach(btn=>target.appendChild(btn));
      sideMenu.appendChild(wrap);
    }

    sideMenu.querySelectorAll('.menu-group-toggle').forEach(toggle=>toggle.addEventListener('click',()=>{
      const id=toggle.dataset.menuGroup;
      const group=toggle.closest('.menu-group');
      const next=group.classList.contains('open')?'':id;
      setOpen(sideMenu,next);
    }));

    const current=state.currentView||'dashboard';
    let groupId=VIEW_TO_GROUP[current]||'';
    if(!groupId&&current!=='dashboard'){
      const activeBtn=sideMenu.querySelector(`button[data-view="${CSS.escape(current)}"]`);
      groupId=activeBtn?.closest('.menu-group')?.dataset.group||'';
    }
    if(!groupId&&current==='dashboard')groupId='';
    if(!groupId){
      const saved=remembered();
      if(saved&&sideMenu.querySelector(`.menu-group[data-group="${CSS.escape(saved)}"]`))groupId=saved;
    }
    setOpen(sideMenu,groupId);
    syncActiveGroup();
  }

  function syncActiveGroup(){
    const sideMenu=document.getElementById('sideMenu');
    if(!sideMenu)return;
    sideMenu.querySelectorAll('.menu-group').forEach(group=>{
      const hasActive=!!group.querySelector('button[data-view].active');
      group.querySelector('.menu-group-toggle')?.classList.toggle('has-active',hasActive);
      if(hasActive&&!group.classList.contains('open'))setOpen(sideMenu,group.dataset.group);
    });
  }

  injectStyles();
  const previousBuildMenu=window.buildMenu;
  window.buildMenu=function(){
    previousBuildMenu();
    organize();
  };

  const previousRenderView=window.renderView;
  window.renderView=async function(view){
    const out=await previousRenderView(view);
    syncActiveGroup();
    return out;
  };
})();
