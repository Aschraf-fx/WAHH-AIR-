-- WAHH AIR setup part 2/4: public/self-service RPCs and sale finalization
-- -------------------------
-- Public / self-service RPCs
-- -------------------------
create or replace function public.get_public_members()
returns table(public_id text, role text, status text)
language sql stable security definer set search_path = '' as $$
  select p.public_id,p.role,p.status from public.profiles p
  where p.role in ('rider','agent') and p.status <> 'terminated'
  order by p.created_at;
$$;

create or replace function public.get_public_flavour_stock()
returns table(flavour_name text, selling_price numeric, quantity bigint, stock_status text)
language sql stable security definer set search_path = '' as $$
  select f.name,f.selling_price,coalesce(sum(ib.quantity),0)::bigint,
    case when coalesce(sum(ib.quantity),0)=0 then 'OUT'
         when coalesce(sum(ib.quantity),0)<=f.low_stock_threshold then 'LIMITED'
         else 'AVAILABLE' end
  from public.flavours f
  left join public.inventory_balances ib on ib.flavour_id=f.id
  where f.active=true and f.public_visible=true
  group by f.id,f.name,f.selling_price,f.low_stock_threshold
  order by f.created_at;
$$;

create or replace function public.get_public_member_stock()
returns table(public_id text, role text, flavour_name text, quantity integer)
language sql stable security definer set search_path = '' as $$
  select p.public_id,p.role,f.name,ib.quantity
  from public.profiles p
  join public.stock_locations sl on sl.user_id=p.id and sl.active=true
  join public.inventory_balances ib on ib.location_id=sl.id and ib.quantity>0
  join public.flavours f on f.id=ib.flavour_id and f.active=true
  where p.role in ('rider','agent') and p.status='active'
  order by p.public_id,f.name;
$$;

create or replace function public.get_my_stock()
returns table(flavour_id uuid, flavour_name text, selling_price numeric, quantity integer)
language sql stable security definer set search_path = '' as $$
  select f.id,f.name,f.selling_price,coalesce(ib.quantity,0)
  from public.flavours f
  cross join public.stock_locations sl
  left join public.inventory_balances ib on ib.location_id=sl.id and ib.flavour_id=f.id
  where sl.user_id=(select auth.uid()) and f.active=true and public.is_active_user()
  order by f.created_at;
$$;

create or replace function public.get_my_dashboard()
returns table(today_sales numeric,today_units bigint,today_commission numeric,current_stock bigint)
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select sum(s.total_amount) from public.sales s where s.seller_id=(select auth.uid()) and s.status='finalized' and s.sale_date::date=current_date),0),
    coalesce((select sum(si.quantity) from public.sale_items si join public.sales s on s.id=si.sale_id where s.seller_id=(select auth.uid()) and s.status='finalized' and s.sale_date::date=current_date),0),
    coalesce((select sum(s.commission_amount) from public.sales s where s.seller_id=(select auth.uid()) and s.status='finalized' and s.sale_date::date=current_date),0),
    coalesce((select sum(ib.quantity) from public.stock_locations sl join public.inventory_balances ib on ib.location_id=sl.id where sl.user_id=(select auth.uid())),0)
  where public.is_active_user();
$$;

create or replace function public.get_my_sales(p_limit integer default 100)
returns table(sale_date timestamptz,status text,total_amount numeric,commission_amount numeric,net_to_business numeric,commission_status text)
language sql stable security definer set search_path = '' as $$
  select s.sale_date,s.status,s.total_amount,s.commission_amount,s.net_to_business,s.commission_status
  from public.sales s where s.seller_id=(select auth.uid()) and public.is_active_user()
  order by s.sale_date desc limit greatest(1,least(coalesce(p_limit,100),500));
$$;

create or replace function public.get_my_commission_summary()
returns table(total_earned numeric,pending_amount numeric,approved_amount numeric,paid_amount numeric)
language sql stable security definer set search_path = '' as $$
  select
    coalesce(sum(s.commission_amount) filter(where s.status='finalized'),0),
    coalesce(sum(s.commission_amount) filter(where s.status='finalized' and s.commission_status='pending'),0),
    coalesce(sum(s.commission_amount) filter(where s.status='finalized' and s.commission_status='approved'),0),
    coalesce(sum(s.commission_amount) filter(where s.status='finalized' and s.commission_status='paid'),0)
  from public.sales s where s.seller_id=(select auth.uid()) and public.is_active_user();
$$;

create or replace function public.update_my_profile(p_full_name text,p_phone text default null)
returns table(public_id text,full_name text,phone text,role text,status text)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_active_user() then raise exception 'Account inactive'; end if;
  if nullif(trim(p_full_name),'') is null then raise exception 'Nama diperlukan'; end if;
  update public.profiles set full_name=trim(p_full_name),phone=nullif(trim(coalesce(p_phone,'')),'') where id=(select auth.uid());
  update public.stock_locations set name=trim(p_full_name) where user_id=(select auth.uid());
  return query select p.public_id,p.full_name,p.phone,p.role,p.status from public.profiles p where p.id=(select auth.uid());
end;$$;

-- -------------------------
-- Finalize sale + auto invoice
-- -------------------------
create or replace function public._finalize_sale_for(p_seller_id uuid,p_items jsonb,p_notes text,p_created_by uuid)
returns table(sale_id uuid,invoice_no text,total_sales numeric,commission_amount numeric,net_to_business numeric)
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.profiles%rowtype;
  v_loc uuid;
  v_sale uuid;
  v_item jsonb;
  v_flavour uuid;
  v_qty integer;
  v_price numeric;
  v_cogs numeric;
  v_stock integer;
  v_total numeric:=0;
  v_total_cogs numeric:=0;
  v_total_qty integer:=0;
  v_comm_mode text;
  v_comm_value numeric:=0;
  v_comm numeric:=0;
  v_net numeric:=0;
  v_invoice text;
  v_payload jsonb;
begin
  select * into v_profile from public.profiles where id=p_seller_id for update;
  if not found or v_profile.role not in ('rider','agent') or v_profile.status<>'active' then raise exception 'Seller tidak aktif'; end if;
  select id into v_loc from public.stock_locations where user_id=p_seller_id and active=true;
  if v_loc is null then raise exception 'Stock location seller tidak ditemui'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Tiada item jualan'; end if;

  insert into public.sales(seller_id,created_by,notes) values(p_seller_id,p_created_by,p_notes) returning id into v_sale;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_flavour := (v_item->>'flavour_id')::uuid;
    v_qty := coalesce((v_item->>'quantity')::integer,0);
    if v_qty<=0 then continue; end if;
    select selling_price into v_price from public.flavours where id=v_flavour and active=true;
    if v_price is null then raise exception 'Perisa tidak sah'; end if;
    insert into public.inventory_balances(location_id,flavour_id,quantity) values(v_loc,v_flavour,0) on conflict do nothing;
    select quantity into v_stock from public.inventory_balances where location_id=v_loc and flavour_id=v_flavour for update;
    if v_stock < v_qty then raise exception 'Stok tidak cukup untuk salah satu perisa'; end if;
    v_cogs := public.calculate_flavour_cost(v_flavour);
    insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs)
    values(v_sale,v_flavour,v_qty,v_price,v_cogs,round(v_price*v_qty,2),round(v_cogs*v_qty,2));
    update public.inventory_balances set quantity=quantity-v_qty,updated_at=now() where location_id=v_loc and flavour_id=v_flavour;
    insert into public.stock_movements(flavour_id,from_location_id,quantity,movement_type,reference_type,reference_id,reason,created_by)
    values(v_flavour,v_loc,v_qty,'sale','sale',v_sale,'Finalized sale',p_created_by);
    v_total:=v_total+(v_price*v_qty); v_total_cogs:=v_total_cogs+(v_cogs*v_qty); v_total_qty:=v_total_qty+v_qty;
  end loop;

  if v_total_qty=0 then raise exception 'Tiada quantity jualan yang sah'; end if;
  select mode,value into v_comm_mode,v_comm_value from public.commission_rules where role=v_profile.role and active=true;
  if v_comm_mode='percent' then v_comm:=round(v_total*coalesce(v_comm_value,0)/100,2);
  else v_comm:=round(v_total_qty*coalesce(v_comm_value,0),2); end if;
  v_total:=round(v_total,2); v_total_cogs:=round(v_total_cogs,2); v_net:=round(v_total-v_comm,2);
  update public.sales set total_amount=v_total,total_cogs=v_total_cogs,commission_amount=v_comm,net_to_business=v_net where id=v_sale;

  v_invoice := 'WA-INV-'||to_char(current_date,'YYYYMMDD')||'-'||lpad(nextval('public.invoice_seq')::text,6,'0');
  select jsonb_build_object(
      'items',coalesce(jsonb_agg(jsonb_build_object('flavour_name',f.name,'quantity',si.quantity,'unit_price',si.unit_price,'line_total',si.line_total,'unit_cogs',si.unit_cogs)),'[]'::jsonb),
      'notes',p_notes
    ) into v_payload
  from public.sale_items si join public.flavours f on f.id=si.flavour_id where si.sale_id=v_sale;

  insert into public.invoices(invoice_no,sale_id,seller_public_id,seller_name,seller_role,sale_date,total_sales,commission_amount,net_to_business,payload)
  values(v_invoice,v_sale,v_profile.public_id,v_profile.full_name,v_profile.role,now(),v_total,v_comm,v_net,v_payload);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values(p_created_by,'SALE_FINALIZED','sale',v_sale::text,jsonb_build_object('seller_public_id',v_profile.public_id,'invoice_no',v_invoice,'total_sales',v_total));
  return query select v_sale,v_invoice,v_total,v_comm,v_net;
end;$$;

revoke execute on function public._finalize_sale_for(uuid,jsonb,text,uuid) from public,anon,authenticated;

create or replace function public.finalize_sale(p_items jsonb,p_notes text default null)
returns table(sale_id uuid,invoice_no text,total_sales numeric,commission_amount numeric,net_to_business numeric)
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid:=(select auth.uid()); v_role text; v_status text;
begin
  select role,status into v_role,v_status from public.profiles where id=v_uid;
  if v_role not in ('rider','agent') or v_status<>'active' then raise exception 'Rider/Ejen active sahaja'; end if;
  return query select * from public._finalize_sale_for(v_uid,p_items,p_notes,v_uid);
end;$$;
