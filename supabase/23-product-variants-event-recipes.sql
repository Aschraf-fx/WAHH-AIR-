-- WAHH AIR product variants + event recipe stock sync
-- Adds 100ml event variants without changing the existing retail/flavour stock flow.
-- Run after 13-event-stock-and-editing.sql (and safe after later migrations).

create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  flavour_id uuid not null references public.flavours(id) on delete cascade,
  name text not null,
  volume_ml integer not null check (volume_ml > 0),
  channel text not null default 'event' check (channel in ('event','retail','other')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(flavour_id,volume_ml,channel)
);

create table if not exists public.variant_recipes (
  id uuid primary key default gen_random_uuid(),
  variant_id uuid not null references public.product_variants(id) on delete cascade,
  material_id uuid not null references public.materials(id) on delete cascade,
  qty_required numeric(16,6) not null check (qty_required > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(variant_id,material_id)
);

create table if not exists public.event_variant_items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event_orders(id) on delete cascade,
  variant_id uuid not null references public.product_variants(id),
  quantity integer not null check (quantity > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(event_id,variant_id)
);

alter table public.event_material_usages
  add column if not exists usage_source text not null default 'manual';

do $$ begin
  alter table public.event_material_usages
    add constraint event_material_usages_source_check
    check (usage_source in ('manual','variant_recipe'));
exception when duplicate_object then null; end $$;

create index if not exists idx_variant_recipes_variant on public.variant_recipes(variant_id);
create index if not exists idx_event_variant_items_event on public.event_variant_items(event_id);
create index if not exists idx_event_material_usage_source on public.event_material_usages(event_id,usage_source);

alter table public.product_variants enable row level security;
alter table public.variant_recipes enable row level security;
alter table public.event_variant_items enable row level security;
revoke all on table public.product_variants from anon,authenticated;
revoke all on table public.variant_recipes from anon,authenticated;
revoke all on table public.event_variant_items from anon,authenticated;

-- Seed the actual 100ml event SKUs. Recipe quantities are intentionally NOT guessed.
insert into public.product_variants(flavour_id,name,volume_ml,channel)
select f.id, f.name || ' 100ml', 100, 'event'
from public.flavours f
where f.slug in ('honeydew','kopi-kaw','jagung','blueberry')
on conflict (flavour_id,volume_ml,channel) do update
set name=excluded.name,active=true,updated_at=now();

create or replace function public.admin_variant_catalog()
returns table(
  variant_id uuid,flavour_id uuid,flavour_name text,variant_name text,
  volume_ml integer,channel text,active boolean,recipe_count bigint
)
language sql stable security definer set search_path='' as $$
  select v.id,v.flavour_id,f.name,v.name,v.volume_ml,v.channel,v.active,
    (select count(*) from public.variant_recipes r where r.variant_id=v.id)
  from public.product_variants v
  join public.flavours f on f.id=v.flavour_id
  where public.is_admin()
  order by v.channel,v.volume_ml,f.created_at;
$$;

create or replace function public.admin_variant_recipe_list()
returns table(
  recipe_id uuid,variant_id uuid,variant_name text,flavour_name text,volume_ml integer,
  material_id uuid,material_name text,unit text,qty_required numeric
)
language sql stable security definer set search_path='' as $$
  select r.id,v.id,v.name,f.name,v.volume_ml,m.id,m.name,m.unit,r.qty_required
  from public.variant_recipes r
  join public.product_variants v on v.id=r.variant_id
  join public.flavours f on f.id=v.flavour_id
  join public.materials m on m.id=r.material_id
  where public.is_admin()
  order by v.volume_ml,f.created_at,m.name;
$$;

create or replace function public.admin_upsert_variant_recipe(
  p_variant_id uuid,p_material_id uuid,p_qty_required numeric
) returns uuid
language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if coalesce(p_qty_required,0)<=0 then raise exception 'Qty recipe mesti lebih daripada 0'; end if;
  if not exists(select 1 from public.product_variants where id=p_variant_id and active=true) then raise exception 'Product variant tidak sah'; end if;
  if not exists(select 1 from public.materials where id=p_material_id and active=true) then raise exception 'Material tidak sah'; end if;
  insert into public.variant_recipes(variant_id,material_id,qty_required)
  values(p_variant_id,p_material_id,p_qty_required)
  on conflict(variant_id,material_id) do update set qty_required=excluded.qty_required,updated_at=now()
  returning id into v_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'VARIANT_RECIPE_UPSERT','product_variant',p_variant_id::text,
    jsonb_build_object('material_id',p_material_id,'qty_required',p_qty_required));
  return v_id;
end;$$;

create or replace function public.admin_delete_variant_recipe(p_recipe_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_variant uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  delete from public.variant_recipes where id=p_recipe_id returning variant_id into v_variant;
  if not found then raise exception 'Recipe variant tidak ditemui'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'VARIANT_RECIPE_DELETE','product_variant',v_variant::text,jsonb_build_object('recipe_id',p_recipe_id));
end;$$;

create or replace function public.admin_event_variant_state(p_event_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.is_admin() then jsonb_build_object(
    'catalog',coalesce((
      select jsonb_agg(jsonb_build_object(
        'variant_id',v.id,'flavour_id',v.flavour_id,'flavour_name',f.name,'variant_name',v.name,
        'volume_ml',v.volume_ml,'channel',v.channel,
        'recipe_count',(select count(*) from public.variant_recipes r where r.variant_id=v.id)
      ) order by f.created_at)
      from public.product_variants v join public.flavours f on f.id=v.flavour_id
      where v.active=true and v.channel='event'
    ),'[]'::jsonb),
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'variant_id',i.variant_id,'variant_name',v.name,'flavour_name',f.name,
        'volume_ml',v.volume_ml,'quantity',i.quantity
      ) order by f.created_at)
      from public.event_variant_items i
      join public.product_variants v on v.id=i.variant_id
      join public.flavours f on f.id=v.flavour_id
      where i.event_id=p_event_id
    ),'[]'::jsonb),
    'auto_usage_count',(select count(*) from public.event_material_usages u where u.event_id=p_event_id and u.usage_source='variant_recipe')
  ) end
  where exists(select 1 from public.event_orders e where e.id=p_event_id);
$$;

create or replace function public.admin_set_event_variant_mix(p_event_id uuid,p_items jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_event_qty integer; v_total integer; r record;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select quantity into v_event_qty from public.event_orders where id=p_event_id for update;
  if v_event_qty is null then raise exception 'Event tidak ditemui'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' then raise exception 'Product mix tidak sah'; end if;

  select coalesce(sum((x->>'quantity')::integer),0) into v_total
  from jsonb_array_elements(p_items) x
  where coalesce((x->>'quantity')::integer,0)>0;
  if v_total<>v_event_qty then raise exception 'Jumlah product mix mesti sama dengan quantity event (% botol). Sekarang: %',v_event_qty,v_total; end if;

  if exists(
    select 1 from jsonb_array_elements(p_items) x
    left join public.product_variants v on v.id=(x->>'variant_id')::uuid and v.active=true and v.channel='event'
    where coalesce((x->>'quantity')::integer,0)>0 and v.id is null
  ) then raise exception 'Ada product variant event yang tidak sah'; end if;

  -- If an older recipe sync exists, restore it first. The newly saved mix starts unsynced.
  for r in
    select material_id,quantity from public.event_material_usages
    where event_id=p_event_id and usage_source='variant_recipe'
    for update
  loop
    update public.materials set current_qty=current_qty+r.quantity,updated_at=now() where id=r.material_id;
  end loop;
  delete from public.event_material_usages where event_id=p_event_id and usage_source='variant_recipe';

  delete from public.event_variant_items where event_id=p_event_id;
  insert into public.event_variant_items(event_id,variant_id,quantity)
  select p_event_id,(x->>'variant_id')::uuid,(x->>'quantity')::integer
  from jsonb_array_elements(p_items) x
  where coalesce((x->>'quantity')::integer,0)>0;

  perform public.admin_event_recalculate_partner_shares(p_event_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'EVENT_PRODUCT_MIX_SET','event',p_event_id::text,jsonb_build_object('quantity',v_total));
end;$$;

create or replace function public.admin_sync_event_variant_stock(p_event_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_event_qty integer; v_mix_qty integer; v_item_count integer; v_recipe_item_count integer; r record;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select quantity into v_event_qty from public.event_orders where id=p_event_id for update;
  if v_event_qty is null then raise exception 'Event tidak ditemui'; end if;
  select coalesce(sum(quantity),0),count(*) into v_mix_qty,v_item_count from public.event_variant_items where event_id=p_event_id;
  if v_item_count=0 then raise exception 'Product mix 100ml belum diset'; end if;
  if v_mix_qty<>v_event_qty then raise exception 'Jumlah product mix tidak sama dengan quantity event'; end if;

  select count(*) into v_recipe_item_count
  from public.event_variant_items i
  where i.event_id=p_event_id
    and exists(select 1 from public.variant_recipes r where r.variant_id=i.variant_id);
  if v_recipe_item_count<>v_item_count then raise exception 'Ada product 100ml yang recipe belum lengkap/diset. Lengkapkan recipe dahulu'; end if;

  -- Return previous auto-generated usage first; transaction rollback protects old state if validation below fails.
  for r in
    select material_id,quantity from public.event_material_usages
    where event_id=p_event_id and usage_source='variant_recipe'
    for update
  loop
    update public.materials set current_qty=current_qty+r.quantity,updated_at=now() where id=r.material_id;
  end loop;
  delete from public.event_material_usages where event_id=p_event_id and usage_source='variant_recipe';

  -- Lock all shared materials first, then validate aggregate requirements.
  perform 1
  from public.materials m
  where m.id in (
    select distinct vr.material_id
    from public.event_variant_items i
    join public.variant_recipes vr on vr.variant_id=i.variant_id
    where i.event_id=p_event_id
  )
  order by m.id
  for update;

  for r in
    select m.id material_id,m.name,m.unit,m.current_qty,m.avg_unit_cost,
      sum(i.quantity*vr.qty_required)::numeric need_qty
    from public.event_variant_items i
    join public.variant_recipes vr on vr.variant_id=i.variant_id
    join public.materials m on m.id=vr.material_id
    where i.event_id=p_event_id
    group by m.id,m.name,m.unit,m.current_qty,m.avg_unit_cost
    order by m.id
  loop
    if r.current_qty<r.need_qty then raise exception 'Stok % tidak cukup. Perlu % %, ada % %',r.name,r.need_qty,r.unit,r.current_qty,r.unit; end if;
  end loop;

  for r in
    select m.id material_id,m.name,m.unit,m.avg_unit_cost,
      sum(i.quantity*vr.qty_required)::numeric need_qty
    from public.event_variant_items i
    join public.variant_recipes vr on vr.variant_id=i.variant_id
    join public.materials m on m.id=vr.material_id
    where i.event_id=p_event_id
    group by m.id,m.name,m.unit,m.avg_unit_cost
  loop
    insert into public.event_material_usages(event_id,material_id,material_name,quantity,unit,unit_cost_snapshot,notes,created_by,usage_source)
    values(p_event_id,r.material_id,r.name,r.need_qty,r.unit,r.avg_unit_cost,'Auto: recipe Product 100ml',(select auth.uid()),'variant_recipe');
    update public.materials set current_qty=current_qty-r.need_qty,updated_at=now() where id=r.material_id;
  end loop;

  perform public.admin_event_recalculate_partner_shares(p_event_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'EVENT_VARIANT_STOCK_SYNC','event',p_event_id::text,jsonb_build_object('quantity',v_mix_qty));
end;$$;

grant execute on function public.admin_variant_catalog() to authenticated;
grant execute on function public.admin_variant_recipe_list() to authenticated;
grant execute on function public.admin_upsert_variant_recipe(uuid,uuid,numeric) to authenticated;
grant execute on function public.admin_delete_variant_recipe(uuid) to authenticated;
grant execute on function public.admin_event_variant_state(uuid) to authenticated;
grant execute on function public.admin_set_event_variant_mix(uuid,jsonb) to authenticated;
grant execute on function public.admin_sync_event_variant_stock(uuid) to authenticated;
