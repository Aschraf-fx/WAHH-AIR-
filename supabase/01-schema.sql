-- WAHH AIR setup part 1/4: tables, triggers and helper functions
-- =========================================================
-- WAHH AIR! Management System — Supabase schema v1
-- Run this once in Supabase SQL Editor on a NEW project.
-- =========================================================

create extension if not exists pgcrypto;

create sequence if not exists public.rider_public_seq start 1;
create sequence if not exists public.agent_public_seq start 1;
create sequence if not exists public.invoice_seq start 1;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  public_id text not null unique,
  full_name text not null,
  phone text,
  role text not null check (role in ('rider','agent','admin')),
  status text not null default 'active' check (status in ('active','suspended','terminated')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stock_locations (
  id uuid primary key default gen_random_uuid(),
  location_code text not null unique,
  name text not null,
  location_type text not null check (location_type in ('hq','user')),
  user_id uuid unique references public.profiles(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((location_type='hq' and user_id is null) or (location_type='user' and user_id is not null))
);

insert into public.stock_locations (id, location_code, name, location_type, user_id)
values ('00000000-0000-0000-0000-000000000001','WAHH-HQ','WAHH AIR HQ','hq',null)
on conflict (id) do nothing;

create table if not exists public.flavours (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  slug text not null unique,
  selling_price numeric(12,2) not null default 5 check (selling_price >= 0),
  manual_unit_cogs numeric(12,4) not null default 0 check (manual_unit_cogs >= 0),
  low_stock_threshold integer not null default 10 check (low_stock_threshold >= 0),
  active boolean not null default true,
  public_visible boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.flavours(name,slug,selling_price,manual_unit_cogs,low_stock_threshold)
values
 ('Honeydew','honeydew',5,0,10),
 ('Kopi Kaw','kopi-kaw',5,0,10),
 ('Jagung','jagung',5,0,10),
 ('Blueberry','blueberry',5,0,10)
on conflict (slug) do nothing;

create table if not exists public.inventory_balances (
  location_id uuid not null references public.stock_locations(id) on delete cascade,
  flavour_id uuid not null references public.flavours(id) on delete cascade,
  quantity integer not null default 0 check (quantity >= 0),
  updated_at timestamptz not null default now(),
  primary key (location_id, flavour_id)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  flavour_id uuid not null references public.flavours(id),
  from_location_id uuid references public.stock_locations(id) on delete set null,
  to_location_id uuid references public.stock_locations(id) on delete set null,
  quantity integer not null check (quantity > 0),
  movement_type text not null check (movement_type in ('adjustment_in','adjustment_out','allocation','sale','sale_void','return')),
  reference_type text,
  reference_id uuid,
  reason text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  unit text not null,
  current_qty numeric(16,4) not null default 0 check (current_qty >= 0),
  avg_unit_cost numeric(16,6) not null default 0 check (avg_unit_cost >= 0),
  min_qty numeric(16,4) not null default 0 check (min_qty >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.recipes (
  id uuid primary key default gen_random_uuid(),
  flavour_id uuid not null references public.flavours(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  qty_required numeric(16,6) not null check (qty_required > 0),
  created_at timestamptz not null default now(),
  unique (flavour_id, material_id)
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  supplier text,
  purchased_at timestamptz not null default now(),
  total_cost numeric(14,2) not null default 0 check (total_cost >= 0),
  notes text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  quantity numeric(16,4) not null check (quantity > 0),
  unit_cost numeric(16,6) not null check (unit_cost >= 0),
  total_cost numeric(16,2) generated always as (round((quantity * unit_cost)::numeric,2)) stored,
  created_at timestamptz not null default now()
);

create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  role text not null unique check (role in ('rider','agent')),
  mode text not null default 'fixed' check (mode in ('fixed','percent')),
  value numeric(12,4) not null default 0 check (value >= 0),
  active boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.commission_rules(role,mode,value) values ('rider','fixed',1),('agent','fixed',1.5)
on conflict (role) do nothing;

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  sale_date timestamptz not null default now(),
  status text not null default 'finalized' check (status in ('finalized','void')),
  total_amount numeric(14,2) not null default 0,
  total_cogs numeric(14,2) not null default 0,
  commission_amount numeric(14,2) not null default 0,
  net_to_business numeric(14,2) not null default 0,
  commission_status text not null default 'pending' check (commission_status in ('pending','approved','paid')),
  commission_paid_at timestamptz,
  notes text,
  finalized_at timestamptz not null default now(),
  void_reason text,
  voided_at timestamptz,
  voided_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  flavour_id uuid not null references public.flavours(id),
  quantity integer not null check (quantity > 0),
  unit_price numeric(12,2) not null check (unit_price >= 0),
  unit_cogs numeric(12,4) not null default 0 check (unit_cogs >= 0),
  line_total numeric(14,2) not null,
  line_cogs numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  invoice_no text not null unique,
  sale_id uuid not null unique references public.sales(id),
  seller_public_id text not null,
  seller_name text not null,
  seller_role text not null,
  sale_date timestamptz not null,
  total_sales numeric(14,2) not null,
  commission_amount numeric(14,2) not null,
  net_to_business numeric(14,2) not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'issued' check (status in ('issued','voided')),
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  description text not null,
  amount numeric(14,2) not null check (amount > 0),
  incurred_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  share_percent numeric(7,4) not null check (share_percent >= 0 and share_percent <= 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.partners(name,share_percent)
select 'Partner 1',50 where not exists (select 1 from public.partners);
insert into public.partners(name,share_percent)
select 'Partner 2',50 where (select count(*) from public.partners)=1;

create table if not exists public.partner_distributions (
  id uuid primary key default gen_random_uuid(),
  period_start date not null,
  period_end date not null,
  net_profit numeric(14,2) not null,
  reserve_amount numeric(14,2) not null default 0,
  distributable_profit numeric(14,2) not null,
  status text not null default 'created' check (status in ('created','approved','paid')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (period_end >= period_start)
);

create table if not exists public.partner_distribution_lines (
  id uuid primary key default gen_random_uuid(),
  distribution_id uuid not null references public.partner_distributions(id) on delete cascade,
  partner_id uuid not null references public.partners(id),
  partner_name text not null,
  share_percent numeric(7,4) not null,
  amount numeric(14,2) not null,
  created_at timestamptz not null default now()
);

create table if not exists public.partner_withdrawals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id),
  amount numeric(14,2) not null check (amount > 0),
  notes text,
  withdrawn_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.posters (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  storage_path text not null unique,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_seller_date on public.sales(seller_id,sale_date desc);
create index if not exists idx_sales_status_date on public.sales(status,sale_date desc);
create index if not exists idx_stock_movements_created on public.stock_movements(created_at desc);
create index if not exists idx_audit_created on public.audit_logs(created_at desc);
create index if not exists idx_expenses_date on public.expenses(incurred_at desc);

-- -------------------------
-- Helper functions
-- -------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.role='admin' and p.status='active'
  );
$$;

create or replace function public.is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status='active'
  );
$$;

create or replace function public.calculate_flavour_cost(p_flavour_id uuid)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare v_cost numeric; v_manual numeric;
begin
  select coalesce(sum(r.qty_required * m.avg_unit_cost),0)
  into v_cost
  from public.recipes r join public.materials m on m.id=r.material_id
  where r.flavour_id=p_flavour_id;
  select manual_unit_cogs into v_manual from public.flavours where id=p_flavour_id;
  if v_cost <= 0 then v_cost := coalesce(v_manual,0); end if;
  return round(v_cost::numeric,4);
end;$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_public text;
  v_name text;
begin
  v_role := lower(coalesce(new.raw_user_meta_data->>'role','rider'));
  if v_role not in ('rider','agent') then v_role := 'rider'; end if;
  v_name := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name','')), '');
  if v_name is null then v_name := 'WAHH AIR User'; end if;
  if v_role='agent' then
    v_public := 'WE-' || lpad(nextval('public.agent_public_seq')::text,6,'0');
  else
    v_public := 'WR-' || lpad(nextval('public.rider_public_seq')::text,6,'0');
  end if;
  insert into public.profiles(id,public_id,full_name,phone,role)
  values(new.id,v_public,v_name,nullif(trim(coalesce(new.raw_user_meta_data->>'phone','')),''),v_role);
  insert into public.stock_locations(location_code,name,location_type,user_id)
  values(v_public,v_name,'user',new.id);
  return new;
end;$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at=now(); return new; end;$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists flavours_touch on public.flavours;
create trigger flavours_touch before update on public.flavours for each row execute function public.touch_updated_at();
drop trigger if exists materials_touch on public.materials;
create trigger materials_touch before update on public.materials for each row execute function public.touch_updated_at();
drop trigger if exists partners_touch on public.partners;
create trigger partners_touch before update on public.partners for each row execute function public.touch_updated_at();
