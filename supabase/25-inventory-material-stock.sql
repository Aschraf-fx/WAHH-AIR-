-- Inventory material stock controls: set physical balance and record purchase by total price.

create or replace function public.admin_set_material_quantity(
  p_material_id uuid,
  p_new_quantity numeric,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_quantity numeric;
begin
  if not public.is_admin() then
    raise exception 'Admin sahaja';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'Baki stok tidak sah';
  end if;

  select current_qty
  into v_old_quantity
  from public.materials
  where id=p_material_id
  for update;

  if not found then
    raise exception 'Bahan tidak ditemui';
  end if;

  update public.materials
  set current_qty=p_new_quantity,
      updated_at=now()
  where id=p_material_id;

  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values(
    (select auth.uid()),
    'MATERIAL_STOCK_SET',
    'material',
    p_material_id::text,
    jsonb_build_object(
      'old_quantity',v_old_quantity,
      'new_quantity',p_new_quantity,
      'reason',nullif(trim(coalesce(p_reason,'')),'')
    )
  );
end;
$$;

create or replace function public.admin_record_material_purchase_total(
  p_material_id uuid,
  p_quantity numeric,
  p_total_cost numeric,
  p_supplier text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unit_cost numeric;
begin
  if not public.is_admin() then
    raise exception 'Admin sahaja';
  end if;

  if p_quantity is null or p_quantity<=0 then
    raise exception 'Quantity mesti lebih 0';
  end if;

  if p_total_cost is null or p_total_cost<0 then
    raise exception 'Harga belian tidak sah';
  end if;

  v_unit_cost:=case when p_quantity>0 then p_total_cost/p_quantity else 0 end;

  return public.admin_record_material_purchase(
    p_material_id,
    p_quantity,
    v_unit_cost,
    p_supplier,
    p_notes
  );
end;
$$;

revoke all on function public.admin_set_material_quantity(uuid,numeric,text) from public;
revoke all on function public.admin_record_material_purchase_total(uuid,numeric,numeric,text,text) from public;

grant execute on function public.admin_set_material_quantity(uuid,numeric,text) to authenticated;
grant execute on function public.admin_record_material_purchase_total(uuid,numeric,numeric,text,text) to authenticated;
