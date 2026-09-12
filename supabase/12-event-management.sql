-- WAHH AIR Event Management Module
-- Run once in Supabase SQL Editor after previous migrations.

create table if not exists public.event_orders (
  id uuid primary key default gen_random_uuid(),
  event_name text not null,
  customer_name text not null,
  customer_phone text,
  event_date date not null,
  location text,
  quantity integer not null check (quantity >= 200),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  customer_delivery_charge numeric(12,2) not null default 0 check (customer_delivery_charge >= 0),
  notes text,
  status text not null default 'pending' check (status in ('pending','confirmed','completed','cancelled')),
  base_cost_mode text not null default 'combined' check (base_cost_mode in ('combined','itemized')),
  base_unit_cost numeric(12,4) not null default 0.74 check (base_unit_cost >= 0),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.event_payments (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event_orders(id) on delete cascade,
  amount numeric(14,2) not null check (amount > 0),
  paid_at timestamptz not null default now(),
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.event_commissions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event_orders(id) on delete cascade,
  recipient_name text not null,
  rate_per_bottle numeric(12,4) not null default 0.80 check (rate_per_bottle >= 0),
  quantity integer not null check (quantity > 0),
  amount numeric(14,2) generated always as (round((rate_per_bottle * quantity)::numeric,2)) stored,
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.event_costs (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event_orders(id) on delete cascade,
  category text not null check (category in ('beverage_material','bottle','ice','cooler_box','delivery','packaging','other')),
  description text,
  amount numeric(14,2) not null check (amount >= 0),
  incurred_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists public.event_partner_shares (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event_orders(id) on delete cascade,
  partner_slot smallint not null check (partner_slot in (1,2)),
  partner_id uuid references public.partners(id) on delete set null,
  partner_name text not null,
  share_percent numeric(7,4) not null default 50 check (share_percent >= 0 and share_percent <= 100),
  amount numeric(14,2) not null default 0,
  status text not null default 'pending' check (status in ('pending','paid')),
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,partner_slot)
);

create index if not exists idx_event_orders_date on public.event_orders(event_date desc);
create index if not exists idx_event_orders_status on public.event_orders(status);
create index if not exists idx_event_payments_event on public.event_payments(event_id);
create index if not exists idx_event_commissions_event on public.event_commissions(event_id);
create index if not exists idx_event_costs_event on public.event_costs(event_id);

alter table public.event_orders enable row level security;
alter table public.event_payments enable row level security;
alter table public.event_commissions enable row level security;
alter table public.event_costs enable row level security;
alter table public.event_partner_shares enable row level security;

revoke all on table public.event_orders,public.event_payments,public.event_commissions,public.event_costs,public.event_partner_shares from anon,authenticated;

-- No direct client table access. All access is through admin-only SECURITY DEFINER RPCs below.

create or replace function public.admin_event_recalculate_partner_shares(p_event_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_net numeric;
  v_dist numeric;
  v_one numeric;
  v_two numeric;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;

  select round(
    (e.quantity*e.unit_price + e.customer_delivery_charge)
    - (case when e.base_cost_mode='combined' then e.quantity*e.base_unit_cost else 0 end)
    - coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)
    - coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0)
  ,2) into v_net
  from public.event_orders e where e.id=p_event_id;

  if v_net is null then raise exception 'Event tidak ditemui'; end if;
  v_dist:=greatest(v_net,0);
  v_one:=round(v_dist/2,2);
  v_two:=round(v_dist-v_one,2);

  update public.event_partner_shares set amount=case when partner_slot=1 then v_one else v_two end,updated_at=now()
  where event_id=p_event_id;
end;$$;

create or replace function public.admin_create_event(
  p_event_name text,p_customer_name text,p_customer_phone text,p_event_date date,p_location text,
  p_quantity integer,p_unit_price numeric,p_delivery_charge numeric default 0,p_notes text default null,
  p_status text default 'pending',p_base_cost_mode text default 'combined',p_base_unit_cost numeric default 0.74
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_id uuid;
  p1 record;
  p2 record;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_quantity<200 then raise exception 'Minimum tempahan event ialah 200 botol'; end if;
  if p_unit_price<0 or coalesce(p_delivery_charge,0)<0 or coalesce(p_base_unit_cost,0)<0 then raise exception 'Nilai wang tidak sah'; end if;
  if p_status not in ('pending','confirmed','completed','cancelled') then raise exception 'Status event tidak sah'; end if;
  if p_base_cost_mode not in ('combined','itemized') then raise exception 'Mode kos tidak sah'; end if;

  insert into public.event_orders(event_name,customer_name,customer_phone,event_date,location,quantity,unit_price,customer_delivery_charge,notes,status,base_cost_mode,base_unit_cost,created_by,updated_by)
  values(trim(p_event_name),trim(p_customer_name),nullif(trim(coalesce(p_customer_phone,'')),''),p_event_date,nullif(trim(coalesce(p_location,'')),''),p_quantity,round(p_unit_price,2),round(coalesce(p_delivery_charge,0),2),nullif(trim(coalesce(p_notes,'')),''),p_status,p_base_cost_mode,p_base_unit_cost,(select auth.uid()),(select auth.uid()))
  returning id into v_id;

  select id,name into p1 from public.partners where active=true order by created_at,id limit 1;
  select id,name into p2 from public.partners where active=true and id is distinct from p1.id order by created_at,id limit 1;

  insert into public.event_partner_shares(event_id,partner_slot,partner_id,partner_name,share_percent)
  values(v_id,1,p1.id,coalesce(p1.name,'Partner 1'),50),(v_id,2,p2.id,coalesce(p2.name,'Partner 2'),50);

  perform public.admin_event_recalculate_partner_shares(v_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'EVENT_CREATE','event',v_id::text,jsonb_build_object('event_name',trim(p_event_name),'quantity',p_quantity,'unit_price',p_unit_price));
  return v_id;
end;$$;

create or replace function public.admin_update_event(
  p_event_id uuid,p_event_name text,p_customer_name text,p_customer_phone text,p_event_date date,p_location text,
  p_quantity integer,p_unit_price numeric,p_delivery_charge numeric,p_notes text,p_status text,p_base_cost_mode text,p_base_unit_cost numeric
) returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_quantity<200 then raise exception 'Minimum tempahan event ialah 200 botol'; end if;
  if p_status not in ('pending','confirmed','completed','cancelled') then raise exception 'Status event tidak sah'; end if;
  if p_base_cost_mode not in ('combined','itemized') then raise exception 'Mode kos tidak sah'; end if;
  update public.event_orders set event_name=trim(p_event_name),customer_name=trim(p_customer_name),customer_phone=nullif(trim(coalesce(p_customer_phone,'')),''),event_date=p_event_date,location=nullif(trim(coalesce(p_location,'')),''),quantity=p_quantity,unit_price=round(p_unit_price,2),customer_delivery_charge=round(coalesce(p_delivery_charge,0),2),notes=nullif(trim(coalesce(p_notes,'')),''),status=p_status,base_cost_mode=p_base_cost_mode,base_unit_cost=p_base_unit_cost,updated_by=(select auth.uid()),updated_at=now() where id=p_event_id;
  if not found then raise exception 'Event tidak ditemui'; end if;
  perform public.admin_event_recalculate_partner_shares(p_event_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_UPDATE','event',p_event_id::text,'{}'::jsonb);
end;$$;

create or replace function public.admin_add_event_payment(p_event_id uuid,p_amount numeric,p_paid_at timestamptz default now(),p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_amount<=0 then raise exception 'Bayaran mesti lebih daripada 0'; end if;
  insert into public.event_payments(event_id,amount,paid_at,notes,created_by) values(p_event_id,round(p_amount,2),coalesce(p_paid_at,now()),nullif(trim(coalesce(p_notes,'')),''),(select auth.uid())) returning id into v_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_PAYMENT_ADD','event',p_event_id::text,jsonb_build_object('payment_id',v_id,'amount',p_amount));
  return v_id;
end;$$;

create or replace function public.admin_add_event_cost(p_event_id uuid,p_category text,p_description text,p_amount numeric,p_incurred_at timestamptz default now())
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_mode text;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select base_cost_mode into v_mode from public.event_orders where id=p_event_id;
  if not found then raise exception 'Event tidak ditemui'; end if;
  if p_category not in ('beverage_material','bottle','ice','cooler_box','delivery','packaging','other') then raise exception 'Kategori kos tidak sah'; end if;
  if v_mode='combined' and p_category in ('beverage_material','bottle') then raise exception 'Event ini menggunakan kos gabungan bahan + botol. Tukar kepada Itemized untuk elak kiraan berganda'; end if;
  if p_amount<0 then raise exception 'Kos tidak sah'; end if;
  insert into public.event_costs(event_id,category,description,amount,incurred_at,created_by) values(p_event_id,p_category,nullif(trim(coalesce(p_description,'')),''),round(p_amount,2),coalesce(p_incurred_at,now()),(select auth.uid())) returning id into v_id;
  perform public.admin_event_recalculate_partner_shares(p_event_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_COST_ADD','event',p_event_id::text,jsonb_build_object('cost_id',v_id,'category',p_category,'amount',p_amount));
  return v_id;
end;$$;

create or replace function public.admin_add_event_commission(p_event_id uuid,p_recipient_name text,p_rate numeric default 0.80,p_quantity integer default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_qty integer;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select quantity into v_qty from public.event_orders where id=p_event_id;
  if not found then raise exception 'Event tidak ditemui'; end if;
  v_qty:=coalesce(p_quantity,v_qty);
  if v_qty<=0 or p_rate<0 then raise exception 'Kadar / kuantiti komisen tidak sah'; end if;
  insert into public.event_commissions(event_id,recipient_name,rate_per_bottle,quantity,notes,created_by) values(p_event_id,trim(p_recipient_name),p_rate,v_qty,nullif(trim(coalesce(p_notes,'')),''),(select auth.uid())) returning id into v_id;
  perform public.admin_event_recalculate_partner_shares(p_event_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_COMMISSION_ADD','event',p_event_id::text,jsonb_build_object('commission_id',v_id,'recipient',trim(p_recipient_name),'rate',p_rate,'quantity',v_qty));
  return v_id;
end;$$;

create or replace function public.admin_set_event_commission_status(p_commission_id uuid,p_status text,p_paid_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_status not in ('pending','paid') then raise exception 'Status komisen tidak sah'; end if;
  update public.event_commissions set status=p_status,paid_at=case when p_status='paid' then coalesce(p_paid_at,now()) else null end where id=p_commission_id returning event_id into v_event;
  if not found then raise exception 'Komisen tidak ditemui'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_COMMISSION_STATUS','event',v_event::text,jsonb_build_object('commission_id',p_commission_id,'status',p_status));
end;$$;

create or replace function public.admin_set_event_partner_status(p_share_id uuid,p_status text,p_paid_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_status not in ('pending','paid') then raise exception 'Status partner tidak sah'; end if;
  update public.event_partner_shares set status=p_status,paid_at=case when p_status='paid' then coalesce(p_paid_at,now()) else null end,updated_at=now() where id=p_share_id returning event_id into v_event;
  if not found then raise exception 'Bahagian partner tidak ditemui'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_PARTNER_STATUS','event',v_event::text,jsonb_build_object('share_id',p_share_id,'status',p_status));
end;$$;

create or replace function public.admin_event_list(p_search text default null,p_start date default null,p_end date default null,p_status text default null)
returns table(
  id uuid,event_name text,customer_name text,event_date date,status text,quantity integer,unit_price numeric,
  drink_sales numeric,delivery_income numeric,total_income numeric,received numeric,balance_due numeric,total_cost numeric,total_commission numeric,net_profit numeric
) language sql stable security definer set search_path='' as $$
  select e.id,e.event_name,e.customer_name,e.event_date,e.status,e.quantity,e.unit_price,
    round(e.quantity*e.unit_price,2) drink_sales,e.customer_delivery_charge,
    round(e.quantity*e.unit_price+e.customer_delivery_charge,2) total_income,
    coalesce((select sum(p.amount) from public.event_payments p where p.event_id=e.id),0) received,
    round((e.quantity*e.unit_price+e.customer_delivery_charge)-coalesce((select sum(p.amount) from public.event_payments p where p.event_id=e.id),0),2) balance_due,
    round((case when e.base_cost_mode='combined' then e.quantity*e.base_unit_cost else 0 end)+coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0),2) total_cost,
    coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0) total_commission,
    round((e.quantity*e.unit_price+e.customer_delivery_charge)-(case when e.base_cost_mode='combined' then e.quantity*e.base_unit_cost else 0 end)-coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)-coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0),2) net_profit
  from public.event_orders e
  where public.is_admin()
    and (nullif(trim(coalesce(p_search,'')),'') is null or e.event_name ilike '%'||trim(p_search)||'%' or e.customer_name ilike '%'||trim(p_search)||'%')
    and (p_start is null or e.event_date>=p_start) and (p_end is null or e.event_date<=p_end)
    and (nullif(trim(coalesce(p_status,'')),'') is null or e.status=p_status)
  order by e.event_date desc,e.created_at desc;
$$;

create or replace function public.admin_event_detail(p_event_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.is_admin() then jsonb_build_object(
    'event',to_jsonb(e),
    'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.paid_at desc) from public.event_payments x where x.event_id=e.id),'[]'::jsonb),
    'costs',coalesce((select jsonb_agg(to_jsonb(x) order by x.incurred_at desc) from public.event_costs x where x.event_id=e.id),'[]'::jsonb),
    'commissions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.event_commissions x where x.event_id=e.id),'[]'::jsonb),
    'partners',coalesce((select jsonb_agg(to_jsonb(x) order by x.partner_slot) from public.event_partner_shares x where x.event_id=e.id),'[]'::jsonb)
  ) else null end from public.event_orders e where e.id=p_event_id;
$$;

-- Include completed Event/Wedding activity in management P&L exactly once.
create or replace function public.admin_accounting_summary(p_start date,p_end date)
returns table(revenue numeric,cogs numeric,gross_profit numeric,commission_expense numeric,operating_expenses numeric,net_profit numeric,stock_purchases numeric,inventory_value numeric)
language sql stable security definer set search_path = '' as $$
  with s as (
    select coalesce(sum(total_amount),0) revenue,coalesce(sum(total_cogs),0) cogs,coalesce(sum(commission_amount),0) comm
    from public.sales where status='finalized' and sale_date::date between p_start and p_end
  ), ev as (
    select
      coalesce(sum(e.quantity*e.unit_price+e.customer_delivery_charge),0) revenue,
      coalesce(sum((case when e.base_cost_mode='combined' then e.quantity*e.base_unit_cost else 0 end)+coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)),0) cogs,
      coalesce(sum(coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0)),0) comm
    from public.event_orders e where e.status='completed' and e.event_date between p_start and p_end
  ), e as (
    select coalesce(sum(amount),0) expenses from public.expenses where incurred_at::date between p_start and p_end
  ), p as (
    select coalesce(sum(total_cost),0) purchases from public.purchases where purchased_at::date between p_start and p_end
  ), raw as (
    select coalesce(sum(current_qty*avg_unit_cost),0) val from public.materials where active=true
  ), fin as (
    select coalesce(sum(ib.quantity*public.calculate_flavour_cost(ib.flavour_id)),0) val from public.inventory_balances ib
  )
  select (s.revenue+ev.revenue),(s.cogs+ev.cogs),(s.revenue+ev.revenue-s.cogs-ev.cogs),(s.comm+ev.comm),e.expenses,
    (s.revenue+ev.revenue-s.cogs-ev.cogs-s.comm-ev.comm-e.expenses),p.purchases,(raw.val+fin.val)
  from s,ev,e,p,raw,fin where public.is_admin();
$$;

revoke execute on function public.admin_event_recalculate_partner_shares(uuid) from public;
revoke execute on function public.admin_create_event(text,text,text,date,text,integer,numeric,numeric,text,text,text,numeric) from public;
revoke execute on function public.admin_update_event(uuid,text,text,text,date,text,integer,numeric,numeric,text,text,text,numeric) from public;
revoke execute on function public.admin_add_event_payment(uuid,numeric,timestamptz,text) from public;
revoke execute on function public.admin_add_event_cost(uuid,text,text,numeric,timestamptz) from public;
revoke execute on function public.admin_add_event_commission(uuid,text,numeric,integer,text) from public;
revoke execute on function public.admin_set_event_commission_status(uuid,text,timestamptz) from public;
revoke execute on function public.admin_set_event_partner_status(uuid,text,timestamptz) from public;
revoke execute on function public.admin_event_list(text,date,date,text) from public;
revoke execute on function public.admin_event_detail(uuid) from public;

grant execute on function public.admin_create_event(text,text,text,date,text,integer,numeric,numeric,text,text,text,numeric) to authenticated;
grant execute on function public.admin_update_event(uuid,text,text,text,date,text,integer,numeric,numeric,text,text,text,numeric) to authenticated;
grant execute on function public.admin_add_event_payment(uuid,numeric,timestamptz,text) to authenticated;
grant execute on function public.admin_add_event_cost(uuid,text,text,numeric,timestamptz) to authenticated;
grant execute on function public.admin_add_event_commission(uuid,text,numeric,integer,text) to authenticated;
grant execute on function public.admin_set_event_commission_status(uuid,text,timestamptz) to authenticated;
grant execute on function public.admin_set_event_partner_status(uuid,text,timestamptz) to authenticated;
grant execute on function public.admin_event_list(text,date,date,text) to authenticated;
grant execute on function public.admin_event_detail(uuid) to authenticated;
