/* Targeted fix: allow Admin to edit/delete material purchase records only. */
async function adminPurchases(root){
  const [{data:materials,error},{data:rows,error:historyError}] = await Promise.all([
    state.supabase.from('materials').select('id,name,unit').eq('active',true).order('name'),
    state.supabase.rpc('admin_purchase_history_v2',{p_limit:100})
  ]);
  if(error) throw error;
  if(historyError) throw historyError;

  root.innerHTML = pageHead('ACCOUNTING','Belian Stok Baru','Belian bahan menambah inventory asset dan recalculates weighted-average cost.') + `
    <section class="panel">
      <form id="purchaseForm" class="inline-form">
        <input id="purEditId" type="hidden" value="">
        <div class="field"><label>Bahan</label><select id="purMat">${(materials||[]).map(x=>`<option value="${x.id}">${esc(x.name)} (${esc(x.unit)})</option>`).join('')}</select></div>
        <div class="field"><label>Qty</label><input id="purQty" type="number" min="0.0001" step="0.0001" required></div>
        <div class="field"><label>Unit Cost RM</label><input id="purCost" type="number" min="0" step="0.0001" required></div>
        <div class="field"><label>Supplier</label><input id="purSupplier" placeholder="Nama supplier"></div>
        <button class="btn primary" id="purSubmit" type="submit">Rekod Belian</button>
        <button class="btn ghost hidden" id="purCancelEdit" type="button">Batal Edit</button>
      </form>
    </section>
    <section class="panel">
      <div class="table-wrap"><table class="data-table">
        <thead><tr><th>Tarikh</th><th>Bahan</th><th>Supplier</th><th class="num">Qty</th><th class="num">Unit Cost</th><th class="num">Total</th><th>Tindakan</th></tr></thead>
        <tbody>${rows?.length ? rows.map(r=>`<tr>
          <td>${dateMY(r.purchased_at)}</td><td>${esc(r.material_name)}</td><td>${esc(r.supplier||'-')}</td>
          <td class="num">${num(r.quantity,3)} ${esc(r.unit)}</td><td class="num">${money(r.unit_cost)}</td><td class="num">${money(r.total_cost)}</td>
          <td><div class="row-actions" style="margin:0;justify-content:flex-start"><button class="btn sm ghost purchase-edit" type="button" data-id="${r.purchase_id}" data-material="${r.material_id}" data-qty="${r.quantity}" data-cost="${r.unit_cost}" data-supplier="${esc(r.supplier||'')}">Edit</button><button class="btn sm danger purchase-delete" type="button" data-id="${r.purchase_id}">Delete</button></div></td>
        </tr>`).join('') : tableEmpty(7)}</tbody>
      </table></div>
    </section>`;

  const resetPurchaseForm = () => {
    $('#purchaseForm',root).reset();
    $('#purEditId',root).value='';
    $('#purSubmit',root).textContent='Rekod Belian';
    $('#purCancelEdit',root).classList.add('hidden');
    $('#purMat',root).disabled=false;
  };

  $$('.purchase-edit',root).forEach(b=>b.addEventListener('click',()=>{
    $('#purEditId',root).value=b.dataset.id;
    $('#purMat',root).value=b.dataset.material;
    $('#purQty',root).value=b.dataset.qty;
    $('#purCost',root).value=b.dataset.cost;
    $('#purSupplier',root).value=b.dataset.supplier||'';
    $('#purSubmit',root).textContent='Simpan Perubahan';
    $('#purCancelEdit',root).classList.remove('hidden');
    $('#purMat',root).focus();
    window.scrollTo({top:0,behavior:'smooth'});
  }));

  $('#purCancelEdit',root).addEventListener('click',resetPurchaseForm);

  $$('.purchase-delete',root).forEach(b=>b.addEventListener('click',async()=>{
    const ok=await confirmAction('Delete rekod belian?','Rekod ini akan dibuang dan quantity serta average cost bahan akan dilaraskan semula. Tindakan ini direkod dalam Audit Log.');
    if(!ok)return;
    const {error}=await state.supabase.rpc('admin_delete_material_purchase',{p_purchase_id:b.dataset.id});
    if(error)return toast(error.message,'error');
    toast('Rekod belian dipadam dan inventory cost dilaraskan.','success');
    renderView('purchases');
  }));

  $('#purchaseForm',root).addEventListener('submit',async e=>{
    e.preventDefault();
    const b=e.submitter;
    setBusy(b,true);
    const editId=$('#purEditId',root).value;
    const args={
      p_material_id:$('#purMat',root).value,
      p_quantity:Number($('#purQty',root).value),
      p_unit_cost:Number($('#purCost',root).value),
      p_supplier:$('#purSupplier',root).value.trim()||null,
      p_notes:null
    };
    const result=editId
      ? await state.supabase.rpc('admin_update_material_purchase',{p_purchase_id:editId,...args})
      : await state.supabase.rpc('admin_record_material_purchase',args);
    setBusy(b,false);
    if(result.error)return toast(result.error.message,'error');
    toast(editId?'Belian berjaya dikemas kini dan average cost dilaraskan.':'Belian stok direkod dan average cost dikemas kini.','success');
    renderView('purchases');
  });
}
