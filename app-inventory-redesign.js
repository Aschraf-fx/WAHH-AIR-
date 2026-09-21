/* Inventory workspace — CRUD-first redesign.
   Replaces the previous 6-tab layout (3 read-only views + 3 detached action forms)
   with 3 tabs where every row carries its own actions. Data entry happens in
   dialogs, so each tab is a clean table first and a form only when you ask for one.

   Key change: finished goods can now be set to an absolute balance. Previously the
   only control was admin_adjust_hq_stock(), which takes a +/- change, so an admin
   counting 9 bottles who wanted 50 had to compute +41 by hand. Materials already had
   an absolute setter, so the two halves of this screen behaved differently. */
(function () {
  const INVENTORY_VIEW = 'stock';
  const TAB_KEY = 'wahhInventoryTab';
  const TABS = [
    ['overview', 'Stok Siap'],
    ['materials', 'Bahan Mentah'],
    ['history', 'Sejarah Stok']
  ];

  const previousRenderAdmin = window.renderAdmin;
  if (typeof previousRenderAdmin !== 'function') return;

  window.renderAdmin = async function (view, root) {
    if (view === INVENTORY_VIEW) return renderInventory(root);
    return previousRenderAdmin(view, root);
  };

  /* Exposed so app-admin1.js's adminStock() stub can delegate here instead of
     keeping a second, divergent copy of this screen. */
  window.wahhRenderInventory = renderInventory;

  let activeTab = (() => {
    try { return localStorage.getItem(TAB_KEY) || 'overview'; } catch (_) { return 'overview'; }
  })();

  function setActiveTab(tab) {
    activeTab = tab;
    try { localStorage.setItem(TAB_KEY, tab); } catch (_) { }
  }

  function sum(rows, key = 'quantity') {
    return (rows || []).reduce((total, row) => total + Number(row[key] || 0), 0);
  }

  function byName(rows) {
    const map = new Map();
    (rows || []).forEach(row => map.set(row.flavour_name, row));
    return map;
  }

  function hqRows(stock) {
    return (stock || []).filter(row => row.location_code === 'WAHH-HQ');
  }

  function teamRows(stock) {
    return (stock || []).filter(row => row.location_code !== 'WAHH-HQ');
  }

  /* ------------------------------------------------------------- dialogs */
  /* "Edit baki" used to run two window.prompt() calls: blocking browser popups
     with no context, no keyboard support and no way to show the current value
     beside the new one. This dialog reuses the app's own modal plumbing
     (openModal/closeModal) so the existing focus trap and Escape handling apply. */
  let dialogSubmit = null;

  function ensureDialog() {
    if ($('#invDialog')) return;
    const wrap = document.createElement('div');
    wrap.id = 'invDialog';
    wrap.className = 'modal hidden';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-labelledby', 'invDialogTitle');
    wrap.innerHTML = `
      <div class="modal-card inv-dialog-card">
        <button class="modal-close" type="button" data-inv-dialog-close aria-label="Tutup">×</button>
        <h3 id="invDialogTitle"></h3>
        <p id="invDialogDesc" class="muted inv-dialog-desc"></p>
        <form id="invDialogForm">
          <div id="invDialogBody"></div>
          <div id="invDialogFields"></div>
          <div class="row-actions inv-dialog-actions">
            <button class="btn ghost" type="button" data-inv-dialog-close>Batal</button>
            <button class="btn primary" type="submit" id="invDialogSubmit">Simpan</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(wrap);

    wrap.addEventListener('click', e => { if (e.target === wrap) closeInvDialog(); });
    $$('[data-inv-dialog-close]', wrap).forEach(b => b.addEventListener('click', closeInvDialog));

    $('#invDialogForm', wrap).addEventListener('submit', async e => {
      e.preventDefault();
      if (!dialogSubmit) return;
      const btn = $('#invDialogSubmit', wrap);
      const form = $('#invDialogForm', wrap);
      const read = (name) => {
        const el = $(`#invF_${name}`, form);
        return el ? el.value : '';
      };
      const num = (name) => Number(read(name));
      setBusy(btn, true, 'Menyimpan...');
      let done = false;
      try {
        done = await dialogSubmit({ read, num, form });
      } catch (err) {
        toast(err?.message || 'Ralat tidak dijangka.', 'error');
      }
      setBusy(btn, false);
      if (done !== false) closeInvDialog();
    });
  }

  function closeInvDialog() {
    dialogSubmit = null;
    closeModal('invDialog');
  }

  function fieldHTML(f) {
    if (f.type === 'static') return `<div class="inv-dialog-static">${f.html}</div>`;
    const id = `invF_${f.name}`;
    const label = `<span class="inv-dialog-label">${esc(f.label)}${f.required ? ' <em aria-hidden="true">*</em>' : ''}</span>`;
    let control;
    if (f.type === 'select') {
      const opts = (f.options || []).map(o =>
        `<option value="${esc(o.value)}"${String(o.value) === String(f.value ?? '') ? ' selected' : ''}>${esc(o.label)}</option>`
      ).join('');
      control = `<select id="${id}"${f.required ? ' required' : ''}>${opts}</select>`;
    } else if (f.type === 'textarea') {
      control = `<textarea id="${id}" rows="${f.rows || 2}" maxlength="${f.maxlength || 200}" placeholder="${esc(f.placeholder || '')}"${f.required ? ' required' : ''}>${esc(f.value ?? '')}</textarea>`;
    } else {
      control = `<input id="${id}" type="${f.type || 'text'}" value="${esc(f.value ?? '')}"`
        + `${f.min !== undefined ? ` min="${f.min}"` : ''}`
        + `${f.max !== undefined ? ` max="${f.max}"` : ''}`
        + `${f.step ? ` step="${f.step}"` : ''}`
        + `${f.inputmode ? ` inputmode="${f.inputmode}"` : ''}`
        + ` maxlength="${f.maxlength || 160}" placeholder="${esc(f.placeholder || '')}"`
        + ` autocomplete="off"${f.required ? ' required' : ''}>`;
    }
    return `<label class="inv-dialog-field">${label}${control}${f.hint ? `<small class="inv-dialog-hint">${esc(f.hint)}</small>` : ''}</label>`;
  }

  function openInvDialog({ title, description = '', body = '', fields = [], submitLabel = 'Simpan', danger = false, onSubmit }) {
    ensureDialog();
    $('#invDialogTitle').textContent = title;
    const desc = $('#invDialogDesc');
    desc.textContent = description;
    desc.hidden = !description;
    $('#invDialogBody').innerHTML = body;
    $('#invDialogFields').innerHTML = fields.map(fieldHTML).join('');
    const btn = $('#invDialogSubmit');
    btn.textContent = submitLabel;
    btn.className = `btn ${danger ? 'danger' : 'primary'}`;
    dialogSubmit = onSubmit;
    openModal('invDialog');
    const first = $('#invDialogFields input, #invDialogFields select, #invDialogFields textarea');
    if (first) setTimeout(() => { try { first.focus(); first.select?.(); } catch (_) { } }, 70);
  }

  /* Let other admin screens reuse the same dialog so the portal has one
     consistent way of asking for input instead of a mix of prompts and forms. */
  window.wahhOpenDialog = openInvDialog;

  /* ------------------------------------------------------------ fetching */
  async function fetchHistory(flavourId) {
    const { data, error } = await state.supabase.rpc('admin_stock_history', {
      p_limit: 300,
      p_flavour_id: flavourId || null
    });
    if (error) throw error;
    return data || [];
  }

  const MOVEMENT_LABEL = {
    adjustment_in: 'Tambah',
    adjustment_out: 'Tolak',
    allocation: 'Agih',
    sale: 'Jualan',
    sale_void: 'Void jualan',
    return: 'Pulangan'
  };

  /* --------------------------------------------------------- main render */
  async function renderInventory(root) {
    const [stockRes, membersRes, flavourRes, materialRes] = await Promise.all([
      state.supabase.rpc('admin_stock_summary'),
      state.supabase.rpc('admin_list_members'),
      state.supabase.from('flavours').select('id,name,low_stock_threshold,active,selling_price,manual_unit_cogs').eq('active', true).order('created_at'),
      state.supabase.from('materials').select('id,name,unit,current_qty,avg_unit_cost,min_qty,active').order('name')
    ]);
    if (stockRes.error) throw stockRes.error;
    if (membersRes.error) throw membersRes.error;
    if (flavourRes.error) throw flavourRes.error;
    if (materialRes.error) throw materialRes.error;

    const stock = stockRes.data || [];
    const flavours = flavourRes.data || [];
    const allMaterials = materialRes.data || [];
    const materials = allMaterials.filter(m => m.active !== false);
    const inactiveMaterials = allMaterials.filter(m => m.active === false);
    const activeMembers = (membersRes.data || []).filter(x => x.status === 'active');

    const hq = hqRows(stock);
    const team = teamRows(stock);
    const hqMap = byName(hq);
    const teamByFlavour = new Map();
    team.forEach(row => {
      teamByFlavour.set(row.flavour_name, (teamByFlavour.get(row.flavour_name) || 0) + Number(row.quantity || 0));
    });

    const hqTotal = sum(hq);
    const teamTotal = sum(team);
    const lowFlavours = flavours.filter(f => Number(hqMap.get(f.name)?.quantity || 0) <= Number(f.low_stock_threshold || 0));
    const lowMaterials = materials.filter(m => Number(m.min_qty || 0) > 0 && Number(m.current_qty || 0) <= Number(m.min_qty || 0));

    if (!TABS.some(([id]) => id === activeTab)) activeTab = 'overview';

    root.innerHTML = pageHead(
      'INVENTORY',
      'Inventori & Stok',
      'Setiap baris ada tindakannya sendiri — set baki, tambah, tolak, agih atau semak sejarah. Tiada lagi kiraan manual.'
    ) + `
      <div class="inv-shell">
        <section class="inv-summary" aria-label="Ringkasan inventori">
          <div class="inv-summary-main">
            <span>Stok HQ</span>
            <strong>${num(hqTotal)}</strong>
            <small>botol tersedia untuk operasi</small>
          </div>
          <dl class="inv-summary-list">
            <div><dt>Dengan Rider / Ejen</dt><dd>${num(teamTotal)}</dd></div>
            <div><dt>Jumlah Dalam Sistem</dt><dd>${num(hqTotal + teamTotal)}</dd></div>
            <div><dt>Flavour Low Stock</dt><dd class="${lowFlavours.length ? 'inv-danger' : ''}">${num(lowFlavours.length)}</dd></div>
            <div><dt>Bahan Perlu Beli</dt><dd class="${lowMaterials.length ? 'inv-danger' : ''}">${num(lowMaterials.length)}</dd></div>
          </dl>
        </section>

        <nav class="inv-tabs" aria-label="Bahagian inventori">
          ${TABS.map(([id, label]) => `<button type="button" class="inv-tab ${activeTab === id ? 'active' : ''}" data-inv-tab="${id}">${label}</button>`).join('')}
        </nav>

        <div id="inventoryWorkspace"></div>
      </div>`;

    $$('.inv-tab', root).forEach(btn => btn.addEventListener('click', () => {
      setActiveTab(btn.dataset.invTab);
      renderInventory(root);
    }));

    const ctx = {
      stock, flavours, materials, inactiveMaterials, activeMembers,
      hqMap, teamByFlavour, hqTotal, teamTotal, lowFlavours, lowMaterials, root
    };
    const host = $('#inventoryWorkspace', root);
    if (activeTab === 'materials') renderMaterials(host, ctx);
    else if (activeTab === 'history') renderHistory(host, ctx);
    else renderOverview(host, ctx);
  }

  /* ------------------------------------------------------ tab: Stok Siap */
  function renderOverview(host, ctx) {
    const { stock, flavours, hqMap, teamByFlavour } = ctx;

    const rows = (flavours || []).map(f => {
      const hqQty = Number(hqMap.get(f.name)?.quantity || 0);
      const teamQty = Number(teamByFlavour.get(f.name) || 0);
      const threshold = Number(f.low_stock_threshold || 0);
      const low = hqQty <= threshold;
      return `<tr>
        <td><strong>${esc(f.name)}</strong><div class="muted">Min ${num(threshold)} botol</div></td>
        <td class="num"><strong>${num(hqQty)}</strong></td>
        <td class="num">${num(teamQty)}</td>
        <td class="num">${num(hqQty + teamQty)}</td>
        <td><span class="inv-stock-state ${low ? 'low' : 'ok'}">${low ? 'Low stock' : 'OK'}</span></td>
        <td class="inv-actions-cell">
          <div class="inv-row-actions">
            <button class="btn sm ghost inv-act" type="button" data-act="set-hq" data-flavour="${esc(f.id)}" data-name="${esc(f.name)}" data-qty="${hqQty}">Set baki</button>
            <button class="btn sm ghost inv-act" type="button" data-act="add-hq" data-flavour="${esc(f.id)}" data-name="${esc(f.name)}" data-qty="${hqQty}" title="Tambah stok siap" aria-label="Tambah stok ${esc(f.name)}">＋</button>
            <button class="btn sm ghost inv-act" type="button" data-act="sub-hq" data-flavour="${esc(f.id)}" data-name="${esc(f.name)}" data-qty="${hqQty}" title="Tolak stok HQ" aria-label="Tolak stok ${esc(f.name)}">−</button>
            <button class="btn sm ghost inv-act" type="button" data-act="history" data-flavour="${esc(f.id)}" data-name="${esc(f.name)}">Sejarah</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    host.innerHTML = `
      <section class="inv-section">
        <div class="inv-section-head inv-section-head-tools">
          <div>
            <h2>Stok Mengikut Flavour</h2>
            <p>HQ ialah stok yang boleh diagih. Stok Rider/Ejen masih dalam sistem tetapi bukan lagi di HQ.</p>
          </div>
          <div class="inv-toolbar">
            <button class="btn primary" type="button" id="invProduceBtn">＋ Tambah Stok Siap</button>
            <button class="btn ghost" type="button" id="invAllocateBtn">Agih ke Rider/Ejen</button>
          </div>
        </div>
        <div class="table-wrap inv-table-wrap">
          <table class="data-table inv-table">
            <thead><tr><th>Flavour</th><th class="num">HQ</th><th class="num">Rider / Ejen</th><th class="num">Jumlah</th><th>Status HQ</th><th>Tindakan</th></tr></thead>
            <tbody>${rows || tableEmpty(6, 'Tiada flavour aktif.')}</tbody>
          </table>
        </div>
      </section>

      <section class="inv-section inv-locations">
        <div class="inv-section-head inv-section-head-tools">
          <div><h2>Stok Mengikut Lokasi</h2><p>Set baki sebenar bagi setiap lokasi, atau terima pulangan daripada Rider/Ejen.</p></div>
          <label class="inv-search">Cari<input id="invStockSearch" type="search" placeholder="Rider, lokasi atau flavour"></label>
        </div>
        <div class="table-wrap inv-table-wrap">
          <table class="data-table inv-table">
            <thead><tr><th>Lokasi</th><th>Nama</th><th>Flavour</th><th class="num">Qty</th><th>Tindakan</th></tr></thead>
            <tbody id="invLocationRows"></tbody>
          </table>
        </div>
      </section>`;

    const renderRows = () => {
      const q = $('#invStockSearch', host).value.trim().toLowerCase();
      const filtered = (stock || []).filter(r => !q || [r.location_code, r.location_name, r.flavour_name].some(v => String(v || '').toLowerCase().includes(q)));
      $('#invLocationRows', host).innerHTML = filtered.length ? filtered.map(r => {
        const isHq = r.location_code === 'WAHH-HQ';
        const flavour = (ctx.flavours || []).find(f => f.name === r.flavour_name);
        const actions = isHq
          ? `<button class="btn sm ghost inv-loc-act" type="button" data-act="set-hq" data-flavour="${esc(flavour?.id || '')}" data-name="${esc(r.flavour_name)}" data-qty="${r.quantity}">Set baki</button>`
          : `<div class="inv-row-actions">
               <button class="btn sm ghost inv-loc-act" type="button" data-act="set-member" data-member="${esc(r.location_code)}" data-member-name="${esc(r.location_name)}" data-flavour="${esc(flavour?.id || '')}" data-name="${esc(r.flavour_name)}" data-qty="${r.quantity}">Set baki</button>
               <button class="btn sm ghost inv-loc-act" type="button" data-act="return" data-member="${esc(r.location_code)}" data-member-name="${esc(r.location_name)}" data-flavour="${esc(flavour?.id || '')}" data-name="${esc(r.flavour_name)}" data-qty="${r.quantity}">Pulangkan</button>
             </div>`;
        return `<tr>
          <td><strong>${esc(r.location_code)}</strong></td>
          <td>${esc(r.location_name)}</td>
          <td>${esc(r.flavour_name)}</td>
          <td class="num">${num(r.quantity)}</td>
          <td class="inv-actions-cell">${actions}</td>
        </tr>`;
      }).join('') : tableEmpty(5, 'Tiada stok sepadan.');
    };
    renderRows();
    $('#invStockSearch', host).addEventListener('input', renderRows);

    $('#invProduceBtn', host).addEventListener('click', () => openProduceDialog(ctx));
    $('#invAllocateBtn', host).addEventListener('click', () => openAllocateDialog(ctx));
    $$('.inv-act, .inv-loc-act', host).forEach(b => b.addEventListener('click', () => handleStockAction(b, ctx)));
  }

  function handleStockAction(btn, ctx) {
    const act = btn.dataset.act;
    const name = btn.dataset.name;
    const flavourId = btn.dataset.flavour;
    const qty = Number(btn.dataset.qty || 0);

    if (act === 'history') {
      setActiveTab('history');
      return renderInventory(ctx.root);
    }
    if (act === 'set-hq') return openSetHqDialog(ctx, { flavourId, name, qty });
    if (act === 'add-hq' || act === 'sub-hq') {
      return openChangeHqDialog(ctx, { flavourId, name, qty, sign: act === 'add-hq' ? 1 : -1 });
    }
    if (act === 'set-member') {
      return openSetMemberDialog(ctx, {
        publicId: btn.dataset.member,
        memberName: btn.dataset.memberName,
        flavourId, name, qty
      });
    }
    if (act === 'return') {
      return openReturnDialog(ctx, {
        publicId: btn.dataset.member,
        memberName: btn.dataset.memberName,
        flavourId, name, qty
      });
    }
  }

  /* -- set HQ balance to an absolute number (the core fix) ---------------- */
  function openSetHqDialog(ctx, { flavourId, name, qty }) {
    openInvDialog({
      title: `Set baki HQ — ${name}`,
      description: 'Masukkan bilangan sebenar yang ada di HQ sekarang. Sistem kira perbezaannya sendiri.',
      body: `<div class="inv-dialog-readout">
          <div><span>Baki sistem</span><strong>${num(qty)}</strong></div>
          <div><span>Baki sebenar</span><strong id="invLiveAfter">${num(qty)}</strong></div>
        </div>`,
      fields: [
        { name: 'qty', label: 'Baki sebenar (botol)', type: 'number', min: 0, step: 1, inputmode: 'numeric', value: qty, required: true },
        { name: 'reason', label: 'Sebab', type: 'text', value: 'Kiraan stok fizikal', required: true, maxlength: 160, hint: 'Contoh: kiraan stok fizikal, botol pecah, stok dibeli dari luar.' }
      ],
      submitLabel: 'Set baki',
      onSubmit: async ({ num: readNum, read }) => {
        const next = readNum('qty');
        if (!Number.isInteger(next) || next < 0) { toast('Baki mesti nombor bulat 0 atau lebih.', 'warning'); return false; }
        if (next === qty) { toast('Baki itu sama dengan baki sistem sekarang.', 'warning'); return false; }
        const { error } = await state.supabase.rpc('admin_set_hq_stock', {
          p_flavour_id: flavourId,
          p_new_quantity: next,
          p_reason: read('reason').trim() || null
        });
        if (error) { toast(error.message, 'error'); return false; }
        toast(`${name}: baki HQ ${num(qty)} → ${num(next)}.`, 'success');
        renderView('stock');
      }
    });
    bindLiveReadout('#invF_qty', '#invLiveAfter', qty, v => num(v));
  }

  /* -- quick +/- with a mandatory reason --------------------------------- */
  function openChangeHqDialog(ctx, { flavourId, name, qty, sign }) {
    const label = sign > 0 ? 'Tambah' : 'Tolak';
    openInvDialog({
      title: `${label} stok HQ — ${name}`,
      description: sign > 0
        ? 'Untuk stok siap yang dibeli dari luar atau kiraan semula yang lebih tinggi. Untuk pengeluaran sendiri, guna "Tambah Stok Siap" supaya bahan mentah ditolak ikut recipe.'
        : 'Untuk botol pecah, rosak atau pelarasan turun.',
      body: `<div class="inv-dialog-readout">
          <div><span>Baki sekarang</span><strong>${num(qty)}</strong></div>
          <div><span>Selepas ${label.toLowerCase()}</span><strong id="invLiveAfter">${num(qty)}</strong></div>
        </div>`,
      fields: [
        { name: 'qty', label: `Bilangan untuk ${label.toLowerCase()}`, type: 'number', min: 1, step: 1, inputmode: 'numeric', value: 1, required: true },
        { name: 'reason', label: 'Sebab', type: 'text', required: true, maxlength: 160, value: sign > 0 ? 'Stok dibeli dari luar' : 'Botol rosak / pecah' }
      ],
      submitLabel: label,
      danger: sign < 0,
      onSubmit: async ({ num: readNum, read }) => {
        const delta = readNum('qty');
        if (!Number.isInteger(delta) || delta < 1) { toast('Bilangan mesti sekurang-kurangnya 1.', 'warning'); return false; }
        if (sign < 0 && delta > qty) { toast(`Stok HQ hanya ${num(qty)} botol.`, 'warning'); return false; }
        const { error } = await state.supabase.rpc('admin_adjust_hq_stock', {
          p_flavour_id: flavourId,
          p_quantity_change: sign * delta,
          p_reason: read('reason').trim() || null
        });
        if (error) { toast(error.message, 'error'); return false; }
        toast(`${name}: ${sign > 0 ? '+' : '−'}${num(delta)} botol.`, 'success');
        renderView('stock');
      }
    });
    bindLiveReadout('#invF_qty', '#invLiveAfter', qty, v => num(Math.max(qty + sign * v, 0)), sign > 0 ? 'inv-up' : 'inv-down');
  }

  /* -- set a member's balance -------------------------------------------- */
  function openSetMemberDialog(ctx, { publicId, memberName, flavourId, name, qty }) {
    openInvDialog({
      title: `Set baki ${memberName}`,
      description: `Tetapkan bilangan ${name} yang benar-benar ada dengan ${memberName} (${publicId}).`,
      body: `<div class="inv-dialog-readout">
          <div><span>Baki sistem</span><strong>${num(qty)}</strong></div>
          <div><span>Baki sebenar</span><strong id="invLiveAfter">${num(qty)}</strong></div>
        </div>`,
      fields: [
        { name: 'qty', label: `Baki sebenar (${name})`, type: 'number', min: 0, step: 1, inputmode: 'numeric', value: qty, required: true },
        { name: 'reason', label: 'Sebab', type: 'text', required: true, maxlength: 160, value: 'Kiraan stok fizikal' }
      ],
      submitLabel: 'Set baki',
      onSubmit: async ({ num: readNum, read }) => {
        const next = readNum('qty');
        if (!Number.isInteger(next) || next < 0) { toast('Baki mesti nombor bulat 0 atau lebih.', 'warning'); return false; }
        if (next === qty) { toast('Baki itu sama dengan baki sistem sekarang.', 'warning'); return false; }
        const { error } = await state.supabase.rpc('admin_set_member_stock', {
          p_public_id: publicId,
          p_flavour_id: flavourId,
          p_new_quantity: next,
          p_reason: read('reason').trim() || null
        });
        if (error) { toast(error.message, 'error'); return false; }
        toast(`${memberName} — ${name}: ${num(qty)} → ${num(next)}.`, 'success');
        renderView('stock');
      }
    });
    bindLiveReadout('#invF_qty', '#invLiveAfter', qty, v => num(v));
  }

  /* -- return stock from a member back to HQ ----------------------------- */
  function openReturnDialog(ctx, { publicId, memberName, flavourId, name, qty }) {
    openInvDialog({
      title: 'Pulangkan stok ke HQ',
      description: `${name} daripada ${memberName} (${publicId}). Baki member sekarang ${num(qty)} botol.`,
      fields: [
        { name: 'qty', label: 'Bilangan dipulangkan', type: 'number', min: 1, max: qty, step: 1, inputmode: 'numeric', value: qty, required: true },
        { name: 'reason', label: 'Sebab', type: 'text', required: true, maxlength: 160, value: 'Pulangan stok ke HQ' }
      ],
      submitLabel: 'Pulangkan ke HQ',
      onSubmit: async ({ num: readNum }) => {
        const q = readNum('qty');
        if (!Number.isInteger(q) || q < 1 || q > qty) { toast(`Bilangan mesti antara 1 dan ${num(qty)}.`, 'warning'); return false; }
        const { error } = await state.supabase.rpc('admin_return_stock', {
          p_public_id: publicId,
          p_flavour_id: flavourId,
          p_quantity: q
        });
        if (error) { toast(error.message, 'error'); return false; }
        toast(`${num(q)} botol ${name} dipulangkan ke HQ.`, 'success');
        renderView('stock');
      }
    });
  }

  function bindLiveReadout(inputSel, outSel, base, format, cls = '') {
    const input = $(inputSel);
    const out = $(outSel);
    if (!input || !out) return;
    input.addEventListener('input', () => {
      const v = Number(input.value || 0);
      out.textContent = format(v);
      if (!cls) {
        out.className = v === base ? '' : (v > base ? 'inv-up' : 'inv-down');
      } else {
        out.className = cls;
      }
    });
  }

  /* -- production: adds finished goods, consumes materials by recipe ------ */
  function openProduceDialog(ctx) {
    const flavours = ctx.flavours || [];
    if (!flavours.length) return toast('Tiada flavour aktif.', 'warning');
    const first = flavours[0];
    openInvDialog({
      title: 'Tambah Stok Siap',
      description: 'Gunakan selepas produk siap dibuat. Bahan mentah ditolak secara automatik ikut recipe.',
      body: `<div class="inv-dialog-readout">
          <div><span>Stok HQ sekarang</span><strong id="invProdNow">${num(ctx.hqMap.get(first.name)?.quantity || 0)}</strong></div>
          <div><span>Selepas tambah</span><strong id="invProdAfter">${num(ctx.hqMap.get(first.name)?.quantity || 0)}</strong></div>
        </div>`,
      fields: [
        { name: 'flavour', label: 'Flavour', type: 'select', required: true, value: first.id, options: flavours.map(f => ({ value: f.id, label: f.name })) },
        { name: 'qty', label: 'Qty siap', type: 'number', min: 1, step: 1, inputmode: 'numeric', value: '', required: true, placeholder: 'Contoh: 50' },
        { name: 'reason', label: 'Nota', type: 'text', value: 'Production', maxlength: 120 }
      ],
      submitLabel: 'Tambah ke Stok HQ',
      onSubmit: async ({ num: readNum, read }) => {
        const q = readNum('qty');
        if (!Number.isInteger(q) || q < 1) { toast('Qty mesti sekurang-kurangnya 1.', 'warning'); return false; }
        const { error } = await state.supabase.rpc('admin_produce_stock', {
          p_flavour_id: read('flavour'),
          p_quantity: q,
          p_reason: read('reason').trim() || 'Production'
        });
        if (error) { toast(error.message, 'error'); return false; }
        toast(`${num(q)} botol ditambah ke stok HQ.`, 'success');
        renderView('stock');
      }
    });
    const sel = $('#invF_flavour');
    const qtyEl = $('#invF_qty');
    const sync = () => {
      const f = flavours.find(x => String(x.id) === String(sel.value));
      const current = Number(ctx.hqMap.get(f?.name)?.quantity || 0);
      const q = Number(qtyEl.value || 0);
      $('#invProdNow').textContent = num(current);
      $('#invProdAfter').textContent = num(current + Math.max(q, 0));
    };
    sel.addEventListener('change', sync);
    qtyEl.addEventListener('input', sync);
  }

  /* -- bulk allocation --------------------------------------------------- */
  function openAllocateDialog(ctx) {
    const flavours = ctx.flavours || [];
    const members = ctx.activeMembers || [];
    if (!flavours.length) return toast('Tiada flavour aktif.', 'warning');
    if (!members.length) return toast('Tiada Rider/Ejen aktif.', 'warning');

    const available = new Map(flavours.map(f => [String(f.id), Number(ctx.hqMap.get(f.name)?.quantity || 0)]));
    const memberOptions = members.map(m => ({ value: m.public_id, label: `${m.public_id} — ${m.full_name}` }));

    openInvDialog({
      title: 'Agih Stok kepada Rider / Ejen',
      description: 'Pilih penerima, tambah setiap flavour yang mahu dihantar, kemudian sahkan sekali.',
      body: `
        <div class="inv-alloc-list-head"><span>Flavour</span><span>Qty</span><span></span></div>
        <div id="invAllocRows" class="inv-alloc-list"></div>
        <div class="inv-alloc-footer">
          <button class="btn ghost" id="invAddFlavour" type="button">＋ Tambah Flavour</button>
          <div class="inv-allocation-total"><span>Jumlah diagih</span><strong id="invAllocationTotal">0 botol</strong></div>
        </div>
        <div id="invAllocateError" class="inv-inline-error" role="alert"></div>`,
      fields: [
        { name: 'member', label: 'Rider / Ejen', type: 'select', required: true, options: [{ value: '', label: 'Pilih penerima...' }].concat(memberOptions) }
      ],
      submitLabel: 'Agih stok',
      onSubmit: async ({ read }) => {
        const publicId = read('member');
        if (!publicId) { toast('Pilih Rider/Ejen dahulu.', 'warning'); return false; }
        if (!validateAlloc()) return false;
        const items = $$('.inv-alloc-row', $('#invAllocRows')).map(row => ({
          flavour_id: $('.inv-alloc-flavour', row).value,
          quantity: Number($('.inv-alloc-qty', row).value || 0)
        }));
        if (items.some(x => !Number.isInteger(x.quantity) || x.quantity < 1)) {
          toast('Masukkan kuantiti sekurang-kurangnya 1 untuk setiap flavour.', 'warning');
          return false;
        }
        const total = items.reduce((a, x) => a + x.quantity, 0);
        const { error } = await state.supabase.rpc('admin_allocate_stock_bulk', { p_public_id: publicId, p_items: items });
        if (error) { toast(error.message, 'error'); return false; }
        toast(`${num(total)} botol diagihkan kepada ${publicId}.`, 'success');
        renderView('stock');
      }
    });

    const rowsHost = $('#invAllocRows');
    const options = (selected = '') => flavours.map(f =>
      `<option value="${f.id}"${String(f.id) === String(selected) ? ' selected' : ''}>${esc(f.name)} — HQ ${num(available.get(String(f.id)) || 0)}</option>`
    ).join('');

    function validateAlloc() {
      const rows = $$('.inv-alloc-row', rowsHost);
      let total = 0;
      const seen = new Set();
      let message = '';
      rows.forEach(row => {
        const id = $('.inv-alloc-flavour', row).value;
        const q = Number($('.inv-alloc-qty', row).value || 0);
        total += Math.max(q, 0);
        row.classList.remove('has-error');
        if (seen.has(id)) { message = 'Flavour yang sama tidak boleh dimasukkan dua kali.'; row.classList.add('has-error'); }
        seen.add(id);
        if (q > Number(available.get(id) || 0)) { message = 'Ada kuantiti yang melebihi stok HQ.'; row.classList.add('has-error'); }
      });
      $('#invAllocationTotal').textContent = `${num(total)} botol`;
      $('#invAllocateError').textContent = message;
      return !message;
    }

    function addRow(selected = '') {
      const row = document.createElement('div');
      row.className = 'inv-alloc-row';
      row.innerHTML = `
        <label><span class="inv-mobile-label">Flavour</span><select class="inv-alloc-flavour">${options(selected)}</select></label>
        <label><span class="inv-mobile-label">Qty</span><input class="inv-alloc-qty" type="number" min="1" step="1" inputmode="numeric" placeholder="0"></label>
        <button class="inv-remove-row" type="button" aria-label="Buang flavour">Buang</button>`;
      $('.inv-remove-row', row).addEventListener('click', () => {
        if ($$('.inv-alloc-row', rowsHost).length === 1) return toast('Sekurang-kurangnya satu flavour diperlukan.', 'warning');
        row.remove();
        validateAlloc();
      });
      $('.inv-alloc-flavour', row).addEventListener('change', validateAlloc);
      $('.inv-alloc-qty', row).addEventListener('input', validateAlloc);
      rowsHost.appendChild(row);
      validateAlloc();
    }

    addRow(flavours[0].id);
    $('#invAddFlavour').addEventListener('click', () => {
      const chosen = new Set($$('.inv-alloc-flavour', rowsHost).map(el => el.value));
      const next = flavours.find(f => !chosen.has(String(f.id)));
      if (!next) return toast('Semua flavour aktif sudah ditambah.', 'warning');
      addRow(next.id);
    });
  }

  /* ------------------------------------------------- tab: Bahan Mentah */
  function renderMaterials(host, ctx) {
    const materials = ctx.materials || [];
    const inactive = ctx.inactiveMaterials || [];

    const rows = materials.map(m => {
      const qty = Number(m.current_qty || 0);
      const min = Number(m.min_qty || 0);
      const low = min > 0 && qty <= min;
      return `<tr>
        <td><strong>${esc(m.name)}</strong><div class="muted">${esc(m.unit)}</div></td>
        <td class="num"><strong>${num(qty, 4)}</strong></td>
        <td class="num">${min > 0 ? num(min, 4) : '—'}</td>
        <td class="num">${money(m.avg_unit_cost)}</td>
        <td class="num">${money(qty * Number(m.avg_unit_cost || 0))}</td>
        <td><span class="inv-stock-state ${low ? 'low' : 'ok'}">${low ? 'Perlu beli' : 'OK'}</span></td>
        <td class="inv-actions-cell">
          <div class="inv-row-actions">
            <button class="btn sm ghost inv-mat-act" type="button" data-act="purchase" data-id="${esc(m.id)}" data-name="${esc(m.name)}" data-unit="${esc(m.unit)}" data-qty="${qty}">＋ Belian</button>
            <button class="btn sm ghost inv-mat-act" type="button" data-act="set" data-id="${esc(m.id)}" data-name="${esc(m.name)}" data-unit="${esc(m.unit)}" data-qty="${qty}">Set baki</button>
            <button class="btn sm ghost inv-mat-act" type="button" data-act="edit" data-id="${esc(m.id)}" data-name="${esc(m.name)}" data-unit="${esc(m.unit)}" data-min="${min}">Edit</button>
            <button class="btn sm ghost inv-mat-act" type="button" data-act="delete" data-id="${esc(m.id)}" data-name="${esc(m.name)}">Nyahaktif</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    const lowCount = (ctx.lowMaterials || []).length;

    host.innerHTML = `
      <section class="inv-section">
        <div class="inv-section-head inv-section-head-tools">
          <div>
            <h2>Baki Bahan Mentah</h2>
            <p>Nilai stok dikira daripada kos purata. ${lowCount ? `<strong class="inv-danger">${lowCount} bahan</strong> sudah sampai paras minimum.` : 'Semua bahan di atas paras minimum.'}</p>
          </div>
          <div class="inv-toolbar">
            <button class="btn primary" type="button" id="invNewMaterialBtn">＋ Bahan Baru</button>
          </div>
        </div>
        <div class="table-wrap inv-table-wrap">
          <table class="data-table inv-table">
            <thead><tr><th>Bahan</th><th class="num">Baki</th><th class="num">Min</th><th class="num">Kos Purata</th><th class="num">Nilai Stok</th><th>Status</th><th>Tindakan</th></tr></thead>
            <tbody>${rows || tableEmpty(7, 'Belum ada bahan.')}</tbody>
          </table>
        </div>
      </section>

      <section class="inv-section">
        <div class="inv-section-head">
          <div><h2>Recipe &amp; Kos Produk</h2><p>Recipe menentukan berapa banyak bahan ditolak setiap kali stok siap dihasilkan. Urus recipe di skrin <strong>Recipe &amp; Costing</strong>.</p></div>
          <div class="inv-toolbar"><button class="btn ghost" type="button" id="invGoRecipe">Buka Recipe &amp; Costing</button></div>
        </div>
      </section>

      ${inactive.length ? `
      <section class="inv-section">
        <div class="inv-section-head">
          <div><h2>Bahan Dinyahaktifkan</h2><p>Bahan ini tidak muncul dalam senarai atau recipe. Aktifkan semula jika masih digunakan.</p></div>
        </div>
        <div class="table-wrap inv-table-wrap">
          <table class="data-table inv-table">
            <thead><tr><th>Bahan</th><th>Unit</th><th class="num">Baki</th><th></th></tr></thead>
            <tbody>${inactive.map(m => `<tr>
              <td><strong>${esc(m.name)}</strong></td>
              <td>${esc(m.unit)}</td>
              <td class="num">${num(m.current_qty, 4)}</td>
              <td class="inv-actions-cell"><button class="btn sm ghost inv-mat-act" type="button" data-act="restore" data-id="${esc(m.id)}" data-name="${esc(m.name)}">Aktifkan semula</button></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </section>` : ''}`;

    $('#invGoRecipe', host).addEventListener('click', () => renderView('materials'));
    $('#invNewMaterialBtn', host).addEventListener('click', () => openMaterialFormDialog(ctx, null));
    $$('.inv-mat-act', host).forEach(b => b.addEventListener('click', () => {
      const d = b.dataset;
      const material = { id: d.id, name: d.name, unit: d.unit, current_qty: Number(d.qty || 0), min_qty: Number(d.min || 0) };
      if (d.act === 'purchase') return openPurchaseDialog(ctx, material);
      if (d.act === 'set') return openSetMaterialDialog(ctx, material);
      if (d.act === 'edit') return openMaterialFormDialog(ctx, material);
      if (d.act === 'delete') return openDeactivateMaterialDialog(ctx, material);
      if (d.act === 'restore') return restoreMaterial(d);
    }));
  }

  async function restoreMaterial(d) {
    const { error } = await state.supabase.from('materials').update({ active: true }).eq('id', d.id);
    if (error) return toast(error.message, 'error');
    toast(`Bahan "${d.name}" diaktifkan semula.`, 'success');
    renderView('stock');
  }

  function openPurchaseDialog(ctx, m) {
    openInvDialog({
      title: `Rekod belian — ${m.name}`,
      description: 'Masukkan berapa banyak dibeli dan jumlah pada resit. Sistem kira kos seunit dan purata baru sendiri.',
      body: `<div class="inv-dialog-readout">
          <div><span>Baki sekarang</span><strong>${num(m.current_qty, 4)} ${esc(m.unit)}</strong></div>
          <div><span>Selepas belian</span><strong id="invMatAfter">${num(m.current_qty, 4)} ${esc(m.unit)}</strong></div>
        </div>`,
      fields: [
        { name: 'qty', label: `Quantity dibeli (${m.unit})`, type: 'number', min: 0.0001, step: 0.0001, inputmode: 'decimal', value: '', required: true, placeholder: 'Contoh: 560' },
        { name: 'total', label: 'Jumlah harga resit (RM)', type: 'number', min: 0, step: 0.01, inputmode: 'decimal', value: '', required: true, placeholder: 'Contoh: 30.00' },
        { name: 'supplier', label: 'Supplier', type: 'text', value: '', maxlength: 120, placeholder: 'Optional' },
        { name: 'unitCostOut', label: 'Kos seunit (dikira)', type: 'static', html: '<strong id="invMatUnitCost">—</strong>' }
      ],
      submitLabel: 'Rekod belian',
      onSubmit: async ({ num: readNum, read }) => {
        const q = readNum('qty');
        const total = readNum('total');
        if (!(q > 0)) { toast('Quantity mesti lebih 0.', 'warning'); return false; }
        if (!(total >= 0)) { toast('Harga belian tidak sah.', 'warning'); return false; }
        const { error } = await state.supabase.rpc('admin_record_material_purchase_total', {
          p_material_id: m.id,
          p_quantity: q,
          p_total_cost: total,
          p_supplier: read('supplier').trim() || null,
          p_notes: 'Inventory restock'
        });
        if (error) { toast(error.message, 'error'); return false; }
        toast(`${m.name}: +${num(q, 4)} ${m.unit} direkod.`, 'success');
        renderView('stock');
      }
    });
    const qtyEl = $('#invF_qty');
    const totalEl = $('#invF_total');
    const sync = () => {
      const q = Number(qtyEl.value || 0);
      const t = Number(totalEl.value || 0);
      $('#invMatAfter').textContent = `${num(m.current_qty + Math.max(q, 0), 4)} ${m.unit}`;
      $('#invMatUnitCost').textContent = q > 0 ? `${money(t / q)} / ${m.unit}` : '—';
    };
    qtyEl.addEventListener('input', sync);
    totalEl.addEventListener('input', sync);
  }

  function openSetMaterialDialog(ctx, m) {
    openInvDialog({
      title: `Set baki — ${m.name}`,
      description: 'Untuk samakan sistem dengan kiraan fizikal. Ini tidak merekod pembelian baru, jadi kos purata tidak berubah.',
      body: `<div class="inv-dialog-readout">
          <div><span>Baki sistem</span><strong>${num(m.current_qty, 4)} ${esc(m.unit)}</strong></div>
          <div><span>Baki sebenar</span><strong id="invMatLive">${num(m.current_qty, 4)} ${esc(m.unit)}</strong></div>
        </div>`,
      fields: [
        { name: 'qty', label: `Baki sebenar (${m.unit})`, type: 'number', min: 0, step: 0.0001, inputmode: 'decimal', value: m.current_qty, required: true },
        { name: 'reason', label: 'Sebab', type: 'text', required: true, maxlength: 160, value: 'Kiraan stok fizikal' }
      ],
      submitLabel: 'Set baki',
      onSubmit: async ({ num: readNum, read }) => {
        const next = readNum('qty');
        if (!Number.isFinite(next) || next < 0) { toast('Baki stok tidak sah.', 'warning'); return false; }
        const { error } = await state.supabase.rpc('admin_set_material_quantity', {
          p_material_id: m.id,
          p_new_quantity: next,
          p_reason: read('reason').trim() || null
        });
        if (error) { toast(error.message, 'error'); return false; }
        toast(`${m.name}: ${num(m.current_qty, 4)} → ${num(next, 4)} ${m.unit}.`, 'success');
        renderView('stock');
      }
    });
    const qtyEl = $('#invF_qty');
    const live = $('#invMatLive');
    qtyEl.addEventListener('input', () => {
      const v = Number(qtyEl.value || 0);
      live.textContent = `${num(v, 4)} ${m.unit}`;
      live.className = v === m.current_qty ? '' : (v > m.current_qty ? 'inv-up' : 'inv-down');
    });
  }

  const UNIT_OPTIONS = [
    { value: 'g', label: 'gram (g)' },
    { value: 'kg', label: 'kilogram (kg)' },
    { value: 'ml', label: 'mililiter (ml)' },
    { value: 'liter', label: 'liter (L)' },
    { value: 'unit', label: 'unit' },
    { value: 'pcs', label: 'keping (pcs)' },
    { value: 'can', label: 'tin (can)' },
    { value: 'botol', label: 'botol' },
    { value: 'pek', label: 'pek' }
  ];

  function openMaterialFormDialog(ctx, material) {
    const isNew = !material;
    openInvDialog({
      title: isNew ? 'Bahan mentah baru' : `Edit bahan — ${material.name}`,
      description: isNew
        ? 'Tambah bahan mentah yang digunakan dalam recipe. Baki permulaan 0 — rekod belian untuk menambahnya.'
        : 'Kemas kini nama, unit atau paras minimum. Baki diubah melalui "Set baki" atau "＋ Belian".',
      fields: [
        { name: 'name', label: 'Nama bahan', type: 'text', required: true, maxlength: 120, value: material?.name || '', placeholder: 'Contoh: Serbuk Honeydew' },
        { name: 'unit', label: 'Unit', type: 'select', required: true, value: material?.unit || 'g', options: UNIT_OPTIONS },
        { name: 'min', label: 'Paras minimum', type: 'number', min: 0, step: 0.0001, inputmode: 'decimal', value: material?.min_qty ?? 0, hint: 'Sistem tandakan "Perlu beli" apabila baki jatuh ke paras ini. Set 0 untuk matikan amaran.' }
      ],
      submitLabel: isNew ? 'Tambah bahan' : 'Simpan perubahan',
      onSubmit: async ({ read, num: readNum }) => {
        const name = read('name').trim();
        const unit = read('unit');
        const min = readNum('min');
        if (!name) { toast('Nama bahan diperlukan.', 'warning'); return false; }
        if (!Number.isFinite(min) || min < 0) { toast('Paras minimum tidak sah.', 'warning'); return false; }
        if (isNew) {
          const { error } = await state.supabase.from('materials').insert({ name, unit, min_qty: min });
          if (error) { toast(error.message, 'error'); return false; }
          toast(`Bahan "${name}" ditambah.`, 'success');
        } else {
          const { error } = await state.supabase.from('materials').update({ name, unit, min_qty: min }).eq('id', material.id);
          if (error) { toast(error.message, 'error'); return false; }
          toast(`Bahan "${name}" dikemas kini.`, 'success');
        }
        renderView('stock');
      }
    });
  }

  function openDeactivateMaterialDialog(ctx, m) {
    openInvDialog({
      title: `Nyahaktif bahan — ${m.name}`,
      description: 'Bahan ini akan disembunyikan daripada senarai dan tidak lagi boleh dipilih dalam recipe. Rekod belian dan recipe lama kekal, dan anda boleh aktifkan semula bila-bila masa.',
      fields: [
        { name: 'confirm', label: `Taip "${m.name}" untuk sahkan`, type: 'text', required: true, maxlength: 120, placeholder: m.name }
      ],
      submitLabel: 'Nyahaktif bahan',
      danger: true,
      onSubmit: async ({ read }) => {
        if (read('confirm').trim() !== m.name) { toast('Nama tidak sepadan.', 'warning'); return false; }
        const { error } = await state.supabase.from('materials').update({ active: false }).eq('id', m.id);
        if (error) { toast(error.message, 'error'); return false; }
        toast(`Bahan "${m.name}" dinyahaktifkan.`, 'success');
        renderView('stock');
      }
    });
  }

  /* -------------------------------------------------- tab: Sejarah Stok */
  async function renderHistory(host, ctx) {
    host.innerHTML = `
      <section class="inv-section">
        <div class="inv-section-head inv-section-head-tools">
          <div>
            <h2>Sejarah Pergerakan Stok</h2>
            <p>Setiap tambah, tolak, agih, jualan dan pulangan direkod di sini — siapa buat, bila, dan sebabnya.</p>
          </div>
          <label class="inv-search">Tapis flavour<select id="invHistoryFlavour">
            <option value="">Semua flavour</option>
            ${(ctx.flavours || []).map(f => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join('')}
          </select></label>
        </div>
        <div id="invHistoryBody" class="inv-history-body"><div class="empty-state">Memuatkan sejarah...</div></div>
      </section>`;

    const body = $('#invHistoryBody', host);
    const load = async (flavourId) => {
      body.innerHTML = '<div class="empty-state">Memuatkan sejarah...</div>';
      let rows;
      try {
        rows = await fetchHistory(flavourId);
      } catch (err) {
        body.innerHTML = `<div class="empty-state">Gagal memuatkan sejarah: ${esc(err.message || 'ralat tidak dijangka')}</div>`;
        return;
      }
      if (!rows.length) {
        body.innerHTML = '<div class="empty-state">Belum ada pergerakan stok direkod.</div>';
        return;
      }
      body.innerHTML = `
        <div class="table-wrap inv-table-wrap">
          <table class="data-table inv-table">
            <thead><tr><th>Masa</th><th>Flavour</th><th>Jenis</th><th>Dari</th><th>Ke</th><th class="num">Qty</th><th>Sebab</th><th>Oleh</th></tr></thead>
            <tbody>${rows.map(r => {
              const type = r.movement_type || '';
              const up = type === 'adjustment_in' || type === 'return';
              return `<tr>
                <td>${dateMY(r.created_at)}</td>
                <td><strong>${esc(r.flavour_name)}</strong></td>
                <td><span class="inv-move ${up ? 'in' : 'out'}">${esc(MOVEMENT_LABEL[type] || type)}</span></td>
                <td>${r.from_code ? esc(r.from_code) : '<span class="muted">—</span>'}</td>
                <td>${r.to_code ? esc(r.to_code) : '<span class="muted">—</span>'}</td>
                <td class="num"><strong>${up ? '+' : '−'}${num(r.quantity)}</strong></td>
                <td>${r.reason ? esc(r.reason) : '<span class="muted">—</span>'}</td>
                <td>${r.actor_public_id ? esc(r.actor_public_id) : '<span class="muted">sistem</span>'}</td>
              </tr>`;
            }).join('')}</tbody>
          </table>
        </div>
        <p class="muted inv-history-note">${num(rows.length)} pergerakan terakhir dipaparkan.</p>`;
    };

    await load('');
    $('#invHistoryFlavour', host).addEventListener('change', e => load(e.target.value || null));
  }
})();
