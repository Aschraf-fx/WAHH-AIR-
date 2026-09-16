-- Targeted migration: Admin may edit/delete material purchase records.
-- This only affects purchase records and the related material current_qty / avg_unit_cost.

create or replace function public.admin_purchase_history_v2(p_limit integer default 100)
returns table(
  purchase_id uuid,
  material_id uuid,
  purchased_at timestamptz,
  material_name text,
  unit text,
  supplier text,
  quantity numeric,
  unit_cost numeric,
  total_cost numeric
)
language sql stable security definer set search_path = '' as $$
  select p.id,pi.material_id,p.purchased_at,m.name,m.unit,p.supplier,pi.quantity,pi.unit_cost,pi.total_cost
  from public.purchase_items pi
  join public.purchases p on p.id=pi.purchase_id
  join public.materials m on m.id=pi.material_id
  where public.is_admin()
  order by p.purchased_at desc
  limit greatest(1,least(coalesce(p_limit,100),1000));
$$;

create or replace function public.admin_update_material_purchase(
  p_purchase_id uuid,
  p_material_id uuid,
  p_quantity numeric,
  p_unit_cost numeric,
  p_supplier text default null,
  p_notes text default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_old_item public.purchase_items%rowtype;
  v_old_purchase public.purchases%rowtype;
  v_old_mat public.materials%rowtype;
  v_new_mat public.materials%rowtype;
  v_remaining_qty numeric;
  v_remaining_value numeric;
  v_new_qty numeric;
  v_new_value numeric;
  v_total numeric;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_quantity<=0 or p_unit_cost<0 then raise exception 'Quantity / cost tidak sah'; end if;

  select * into v_old_purchase from public.purchases where id=p_purchase_id for update;
  if not found then raise exception 'Rekod belian tidak ditemui'; end if;

  select * into v_old_item from public.purchase_items where purchase_id=p_purchase_id for update;
  if not found then raise exception 'Item belian tidak ditemui'; end if;

  select * into v_old_mat from public.materials where id=v_old_item.material_id for update;
  if not found then raise exception 'Bahan asal tidak ditemui'; end if;

  -- Safeguard: do not allow reversing more stock than is still available.
  if v_old_mat.current_qty < v_old_item.quantity then
    raise exception 'Belian ini tidak boleh diedit kerana sebahagian quantity asal telah digunakan. Buat pembetulan stok manual dahulu.';
  end if;

  v_remaining_qty := v_old_mat.current_qty - v_old_item.quantity;
  v_remaining_value := (v_old_mat.current_qty * v_old_mat.avg_unit_cost) - (v_old_item.quantity * v_old_item.unit_cost);
  if v_remaining_value < 0 then v_remaining_value := 0; end if;

  if p_material_id = v_old_item.material_id then
    v_new_qty := v_remaining_qty + p_quantity;
    v_new_value := v_remaining_value + (p_quantity * p_unit_cost);
    update public.materials
      set current_qty=v_new_qty,
          avg_unit_cost=case when v_new_qty>0 then v_new_value/v_new_qty else 0 end
      where id=p_material_id;
  else
    update public.materials
      set current_qty=v_remaining_qty,
          avg_unit_cost=case when v_remaining_qty>0 then v_remaining_value/v_remaining_qty else 0 end
      where id=v_old_item.material_id;

    select * into v_new_mat from public.materials where id=p_material_id for update;
    if not found then raise exception 'Bahan baru tidak ditemui'; end if;
    v_new_qty := v_new_mat.current_qty + p_quantity;
    v_new_value := (v_new_mat.current_qty*v_new_mat.avg_unit_cost) + (p_quantity*p_unit_cost);
    update public.materials
      set current_qty=v_new_qty,
          avg_unit_cost=case when v_new_qty>0 then v_new_value/v_new_qty else 0 end
      where id=p_material_id;
  end if;

  v_total := round(p_quantity*p_unit_cost,2);
  update public.purchase_items
    set material_id=p_material_id,quantity=p_quantity,unit_cost=p_unit_cost
    where purchase_id=p_purchase_id;
  update public.purchases
    set supplier=p_supplier,total_cost=v_total,notes=p_notes
    where id=p_purchase_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'MATERIAL_PURCHASE_EDIT','purchase',p_purchase_id::text,
    jsonb_build_object(
      'old_material_id',v_old_item.material_id,'old_quantity',v_old_item.quantity,'old_unit_cost',v_old_item.unit_cost,
      'new_material_id',p_material_id,'new_quantity',p_quantity,'new_unit_cost',p_unit_cost,'new_total',v_total
    ));
end;$$;

create or replace function public.admin_delete_material_purchase(p_purchase_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_item public.purchase_items%rowtype;
  v_purchase public.purchases%rowtype;
  v_mat public.materials%rowtype;
  v_new_qty numeric;
  v_new_value numeric;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;

  select * into v_purchase from public.purchases where id=p_purchase_id for update;
  if not found then raise exception 'Rekod belian tidak ditemui'; end if;
  select * into v_item from public.purchase_items where purchase_id=p_purchase_id for update;
  if not found then raise exception 'Item belian tidak ditemui'; end if;
  select * into v_mat from public.materials where id=v_item.material_id for update;
  if not found then raise exception 'Bahan tidak ditemui'; end if;

  if v_mat.current_qty < v_item.quantity then
    raise exception 'Belian ini tidak boleh dipadam kerana sebahagian quantity telah digunakan. Buat pembetulan stok manual dahulu.';
  end if;

  v_new_qty := v_mat.current_qty - v_item.quantity;
  v_new_value := (v_mat.current_qty*v_mat.avg_unit_cost) - (v_item.quantity*v_item.unit_cost);
  if v_new_value < 0 then v_new_value := 0; end if;

  update public.materials
    set current_qty=v_new_qty,
        avg_unit_cost=case when v_new_qty>0 then v_new_value/v_new_qty else 0 end
    where id=v_item.material_id;

  delete from public.purchase_items where purchase_id=p_purchase_id;
  delete from public.purchases where id=p_purchase_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'MATERIAL_PURCHASE_DELETE','purchase',p_purchase_id::text,
    jsonb_build_object('material_id',v_item.material_id,'quantity',v_item.quantity,'unit_cost',v_item.unit_cost,'total',v_purchase.total_cost));
end;$$;

revoke execute on function public.admin_purchase_history_v2(integer) from public;
revoke execute on function public.admin_update_material_purchase(uuid,uuid,numeric,numeric,text,text) from public;
revoke execute on function public.admin_delete_material_purchase(uuid) from public;
grant execute on function public.admin_purchase_history_v2(integer) to authenticated;
grant execute on function public.admin_update_material_purchase(uuid,uuid,numeric,numeric,text,text) to authenticated;
grant execute on function public.admin_delete_material_purchase(uuid) to authenticated;
