-- WAHH AIR setup part 3A: Admin operations
create or replace function public.admin_list_members()
returns table(public_id text,full_name text,phone text,role text,status text,created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select p.public_id,p.full_name,p.phone,p.role,p.status,p.created_at
  from public.profiles p where public.is_admin() and p.role in ('rider','agent')
  order by p.created_at desc;
$$;

create or replace function public.admin_set_member_status(p_public_id text,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_target public.profiles%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_status not in ('active','suspended','terminated') then raise exception 'Status tidak sah'; end if;
  select * into v_target from public.profiles where public_id=p_public_id and role in ('rider','agent');
  if not found then raise exception 'Member tidak ditemui'; end if;
  update public.profiles set status=p_status where id=v_target.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'MEMBER_STATUS','profile',p_public_id,jsonb_build_object('status',p_status));
end;$$;

create or replace function public.admin_stock_summary()
returns table(location_code text,location_name text,flavour_name text,quantity integer)
language sql stable security definer set search_path = '' as $$
  select sl.location_code,sl.name,f.name,coalesce(ib.quantity,0)
  from public.stock_locations sl cross join public.flavours f
  left join public.inventory_balances ib on ib.location_id=sl.id and ib.flavour_id=f.id
  where public.is_admin() and sl.active=true and f.active=true
  order by case when sl.location_type='hq' then 0 else 1 end,sl.location_code,f.created_at;
$$;

create or replace function public.admin_adjust_hq_stock(p_flavour_id uuid,p_quantity_change integer,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hq constant uuid:='00000000-0000-0000-0000-000000000001'; v_current integer;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_quantity_change=0 then raise exception 'Quantity tidak boleh 0'; end if;
  insert into public.inventory_balances(location_id,flavour_id,quantity) values(v_hq,p_flavour_id,0) on conflict do nothing;
  select quantity into v_current from public.inventory_balances where location_id=v_hq and flavour_id=p_flavour_id for update;
  if v_current+p_quantity_change<0 then raise exception 'Stok HQ tidak mencukupi'; end if;
  update public.inventory_balances set quantity=quantity+p_quantity_change,updated_at=now() where location_id=v_hq and flavour_id=p_flavour_id;
  insert into public.stock_movements(flavour_id,from_location_id,to_location_id,quantity,movement_type,reason,created_by)
  values(p_flavour_id,case when p_quantity_change<0 then v_hq end,case when p_quantity_change>0 then v_hq end,abs(p_quantity_change),case when p_quantity_change>0 then 'adjustment_in' else 'adjustment_out' end,p_reason,(select auth.uid()));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'HQ_STOCK_ADJUST','flavour',p_flavour_id::text,jsonb_build_object('change',p_quantity_change,'reason',p_reason));
end;$$;

create or replace function public.admin_produce_stock(p_flavour_id uuid,p_quantity integer,p_reason text default 'Production')
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_hq constant uuid:='00000000-0000-0000-0000-000000000001';
  r record;
  v_need numeric;
  v_recipe_count integer:=0;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_quantity<=0 then raise exception 'Qty mesti lebih 0'; end if;
  if not exists(select 1 from public.flavours where id=p_flavour_id and active=true) then raise exception 'Perisa tidak sah'; end if;
  select count(*) into v_recipe_count from public.recipes where flavour_id=p_flavour_id;
  if v_recipe_count=0 then raise exception 'Recipe belum diset untuk perisa ini. Gunakan Stock Correction jika stok siap dibeli dari luar'; end if;

  for r in
    select rec.material_id,rec.qty_required,m.name,m.current_qty
    from public.recipes rec join public.materials m on m.id=rec.material_id
    where rec.flavour_id=p_flavour_id
    for update of m
  loop
    v_need:=r.qty_required*p_quantity;
    if r.current_qty<v_need then raise exception 'Bahan % tidak cukup. Perlu %, ada %',r.name,v_need,r.current_qty; end if;
  end loop;

  for r in select rec.material_id,rec.qty_required from public.recipes rec where rec.flavour_id=p_flavour_id loop
    update public.materials set current_qty=current_qty-(r.qty_required*p_quantity) where id=r.material_id;
  end loop;

  insert into public.inventory_balances(location_id,flavour_id,quantity) values(v_hq,p_flavour_id,0) on conflict do nothing;
  update public.inventory_balances set quantity=quantity+p_quantity,updated_at=now() where location_id=v_hq and flavour_id=p_flavour_id;
  insert into public.stock_movements(flavour_id,to_location_id,quantity,movement_type,reason,created_by)
  values(p_flavour_id,v_hq,p_quantity,'adjustment_in',coalesce(nullif(trim(p_reason),''),'Production'),(select auth.uid()));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'STOCK_PRODUCED','flavour',p_flavour_id::text,jsonb_build_object('quantity',p_quantity,'reason',p_reason,'unit_cogs',public.calculate_flavour_cost(p_flavour_id)));
end;$$;

create or replace function public.admin_allocate_stock(p_public_id text,p_flavour_id uuid,p_quantity integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hq constant uuid:='00000000-0000-0000-0000-000000000001'; v_user uuid; v_loc uuid; v_hq_qty integer;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_quantity<=0 then raise exception 'Qty mesti lebih 0'; end if;
  select id into v_user from public.profiles where public_id=p_public_id and role in ('rider','agent') and status='active';
  if v_user is null then raise exception 'Member tidak aktif / tidak ditemui'; end if;
  select id into v_loc from public.stock_locations where user_id=v_user and active=true;
  insert into public.inventory_balances(location_id,flavour_id,quantity) values(v_hq,p_flavour_id,0) on conflict do nothing;
  insert into public.inventory_balances(location_id,flavour_id,quantity) values(v_loc,p_flavour_id,0) on conflict do nothing;
  select quantity into v_hq_qty from public.inventory_balances where location_id=v_hq and flavour_id=p_flavour_id for update;
  if v_hq_qty<p_quantity then raise exception 'Stok HQ tidak cukup'; end if;
  update public.inventory_balances set quantity=quantity-p_quantity,updated_at=now() where location_id=v_hq and flavour_id=p_flavour_id;
  update public.inventory_balances set quantity=quantity+p_quantity,updated_at=now() where location_id=v_loc and flavour_id=p_flavour_id;
  insert into public.stock_movements(flavour_id,from_location_id,to_location_id,quantity,movement_type,reason,created_by) values(p_flavour_id,v_hq,v_loc,p_quantity,'allocation','HQ allocation',(select auth.uid()));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'STOCK_ALLOCATED','profile',p_public_id,jsonb_build_object('flavour_id',p_flavour_id,'quantity',p_quantity));
end;$$;

create or replace function public.admin_return_stock(p_public_id text,p_flavour_id uuid,p_quantity integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_hq constant uuid:='00000000-0000-0000-0000-000000000001'; v_user uuid; v_loc uuid; v_user_qty integer;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_quantity<=0 then raise exception 'Qty mesti lebih 0'; end if;
  select id into v_user from public.profiles where public_id=p_public_id and role in ('rider','agent');
  if v_user is null then raise exception 'Member tidak ditemui'; end if;
  select id into v_loc from public.stock_locations where user_id=v_user;
  insert into public.inventory_balances(location_id,flavour_id,quantity) values(v_hq,p_flavour_id,0) on conflict do nothing;
  insert into public.inventory_balances(location_id,flavour_id,quantity) values(v_loc,p_flavour_id,0) on conflict do nothing;
  select quantity into v_user_qty from public.inventory_balances where location_id=v_loc and flavour_id=p_flavour_id for update;
  if v_user_qty<p_quantity then raise exception 'Stok member tidak cukup'; end if;
  update public.inventory_balances set quantity=quantity-p_quantity,updated_at=now() where location_id=v_loc and flavour_id=p_flavour_id;
  update public.inventory_balances set quantity=quantity+p_quantity,updated_at=now() where location_id=v_hq and flavour_id=p_flavour_id;
  insert into public.stock_movements(flavour_id,from_location_id,to_location_id,quantity,movement_type,reason,created_by)
  values(p_flavour_id,v_loc,v_hq,p_quantity,'return','Return stock to HQ',(select auth.uid()));
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'STOCK_RETURNED','profile',p_public_id,jsonb_build_object('flavour_id',p_flavour_id,'quantity',p_quantity));
end;$$;

create or replace function public.admin_get_member_stock(p_public_id text)
returns table(flavour_id uuid,flavour_name text,selling_price numeric,quantity integer)
language sql stable security definer set search_path = '' as $$
  select f.id,f.name,f.selling_price,coalesce(ib.quantity,0)
  from public.flavours f
  cross join public.profiles p
  join public.stock_locations sl on sl.user_id=p.id
  left join public.inventory_balances ib on ib.location_id=sl.id and ib.flavour_id=f.id
  where public.is_admin() and p.public_id=p_public_id and p.role in ('rider','agent') and f.active=true
  order by f.created_at;
$$;

create or replace function public.admin_finalize_sale(p_public_id text,p_items jsonb,p_notes text default null)
returns table(sale_id uuid,invoice_no text,total_sales numeric,commission_amount numeric,net_to_business numeric)
language plpgsql security definer set search_path = '' as $$
declare v_seller uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select id into v_seller from public.profiles where public_id=p_public_id and role in ('rider','agent') and status='active';
  if v_seller is null then raise exception 'Seller tidak ditemui'; end if;
  return query select * from public._finalize_sale_for(v_seller,p_items,p_notes,(select auth.uid()));
end;$$;

create or replace function public.admin_sales_list(p_limit integer default 150)
returns table(sale_date timestamptz,invoice_no text,public_id text,seller_name text,status text,commission_status text,total_amount numeric,total_cogs numeric,commission_amount numeric,net_to_business numeric)
language sql stable security definer set search_path = '' as $$
  select s.sale_date,i.invoice_no,i.seller_public_id,i.seller_name,s.status,s.commission_status,s.total_amount,s.total_cogs,s.commission_amount,s.net_to_business
  from public.sales s join public.invoices i on i.sale_id=s.id
  where public.is_admin() order by s.sale_date desc limit greatest(1,least(coalesce(p_limit,150),1000));
$$;

create or replace function public.admin_set_commission_status(p_invoice_no text,p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sale uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_status not in ('pending','approved','paid') then raise exception 'Status komisen tidak sah'; end if;
  select sale_id into v_sale from public.invoices where invoice_no=p_invoice_no and status='issued';
  if v_sale is null then raise exception 'Invoice aktif tidak ditemui'; end if;
  update public.sales set commission_status=p_status,commission_paid_at=case when p_status='paid' then now() else null end where id=v_sale and status='finalized';
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'COMMISSION_STATUS','invoice',p_invoice_no,jsonb_build_object('status',p_status));
end;$$;
