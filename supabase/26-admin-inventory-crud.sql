-- Inventory CRUD upgrade: set absolute balances and read stock movement history.
--
-- Why this exists:
--   admin_adjust_hq_stock() only accepts a *change* (+/-), so an admin who counts
--   9 bottles on the shelf and wants 50 has to compute +41 by hand. Materials
--   already had admin_set_material_quantity() which sets an absolute value, so the
--   two halves of the inventory screen behaved differently. These functions give
--   finished goods the same "set the real number" behaviour and expose the
--   stock_movements audit trail, which was being written but never readable.
--
-- Run this in the Supabase SQL editor. Safe to re-run (create or replace).

-- ---------------------------------------------------------------------------
-- Set HQ finished-goods balance to an absolute value.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_hq_stock(
  p_flavour_id uuid,
  p_new_quantity integer,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hq constant uuid := '00000000-0000-0000-0000-000000000001';
  v_current integer;
  v_diff integer;
begin
  if not public.is_admin() then
    raise exception 'Admin sahaja';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'Baki stok tidak sah';
  end if;

  if not exists (select 1 from public.flavours where id = p_flavour_id) then
    raise exception 'Perisa tidak ditemui';
  end if;

  insert into public.inventory_balances(location_id, flavour_id, quantity)
  values (v_hq, p_flavour_id, 0)
  on conflict do nothing;

  select quantity into v_current
  from public.inventory_balances
  where location_id = v_hq and flavour_id = p_flavour_id
  for update;

  if v_current = p_new_quantity then
    raise exception 'Baki HQ sudah % botol', p_new_quantity;
  end if;

  v_diff := p_new_quantity - v_current;

  update public.inventory_balances
  set quantity = p_new_quantity, updated_at = now()
  where location_id = v_hq and flavour_id = p_flavour_id;

  -- stock_movements.quantity has a check (quantity > 0), so the equal-value case
  -- above must raise before we get here.
  insert into public.stock_movements(
    flavour_id, from_location_id, to_location_id, quantity, movement_type, reason, created_by
  )
  values (
    p_flavour_id,
    case when v_diff < 0 then v_hq end,
    case when v_diff > 0 then v_hq end,
    abs(v_diff),
    case when v_diff > 0 then 'adjustment_in' else 'adjustment_out' end,
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Set baki stok fizikal'),
    (select auth.uid())
  );

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (
    (select auth.uid()),
    'HQ_STOCK_SET',
    'flavour',
    p_flavour_id::text,
    jsonb_build_object('old_quantity', v_current, 'new_quantity', p_new_quantity, 'reason', p_reason)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Set a Rider/Ejen location balance to an absolute value.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_member_stock(
  p_public_id text,
  p_flavour_id uuid,
  p_new_quantity integer,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_loc uuid;
  v_current integer;
  v_diff integer;
begin
  if not public.is_admin() then
    raise exception 'Admin sahaja';
  end if;

  if p_new_quantity is null or p_new_quantity < 0 then
    raise exception 'Baki stok tidak sah';
  end if;

  select id into v_user
  from public.profiles
  where public_id = p_public_id and role in ('rider', 'agent');

  if v_user is null then
    raise exception 'Member tidak ditemui';
  end if;

  select id into v_loc from public.stock_locations where user_id = v_user;
  if v_loc is null then
    raise exception 'Lokasi stok member tidak ditemui';
  end if;

  insert into public.inventory_balances(location_id, flavour_id, quantity)
  values (v_loc, p_flavour_id, 0)
  on conflict do nothing;

  select quantity into v_current
  from public.inventory_balances
  where location_id = v_loc and flavour_id = p_flavour_id
  for update;

  if v_current = p_new_quantity then
    raise exception 'Baki member sudah % botol', p_new_quantity;
  end if;

  v_diff := p_new_quantity - v_current;

  update public.inventory_balances
  set quantity = p_new_quantity, updated_at = now()
  where location_id = v_loc and flavour_id = p_flavour_id;

  insert into public.stock_movements(
    flavour_id, from_location_id, to_location_id, quantity, movement_type, reason, created_by
  )
  values (
    p_flavour_id,
    case when v_diff < 0 then v_loc end,
    case when v_diff > 0 then v_loc end,
    abs(v_diff),
    case when v_diff > 0 then 'adjustment_in' else 'adjustment_out' end,
    coalesce(nullif(trim(coalesce(p_reason, '')), ''), 'Set baki stok fizikal'),
    (select auth.uid())
  );

  insert into public.audit_logs(actor_id, action, entity_type, entity_id, details)
  values (
    (select auth.uid()),
    'MEMBER_STOCK_SET',
    'profile',
    p_public_id,
    jsonb_build_object(
      'flavour_id', p_flavour_id,
      'old_quantity', v_current,
      'new_quantity', p_new_quantity,
      'reason', p_reason
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Read the stock movement trail. Every RPC above already writes to
-- stock_movements, but no screen read it, so there was no way to answer
-- "who moved this stock, when, and why".
-- ---------------------------------------------------------------------------
create or replace function public.admin_stock_history(
  p_limit integer default 200,
  p_flavour_id uuid default null
)
returns table(
  created_at timestamptz,
  flavour_name text,
  movement_type text,
  from_code text,
  to_code text,
  quantity integer,
  reason text,
  actor_public_id text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sm.created_at,
    f.name,
    sm.movement_type,
    fl.location_code,
    tl.location_code,
    sm.quantity,
    sm.reason,
    p.public_id
  from public.stock_movements sm
  join public.flavours f on f.id = sm.flavour_id
  left join public.stock_locations fl on fl.id = sm.from_location_id
  left join public.stock_locations tl on tl.id = sm.to_location_id
  left join public.profiles p on p.id = sm.created_by
  where public.is_admin()
    and (p_flavour_id is null or sm.flavour_id = p_flavour_id)
  order by sm.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
$$;

-- ---------------------------------------------------------------------------
-- Grants: match the pattern in 04-security.sql / 25-inventory-material-stock.sql
-- ---------------------------------------------------------------------------
revoke all on function public.admin_set_hq_stock(uuid, integer, text) from public;
revoke all on function public.admin_set_member_stock(text, uuid, integer, text) from public;
revoke all on function public.admin_stock_history(integer, uuid) from public;

grant execute on function public.admin_set_hq_stock(uuid, integer, text) to authenticated;
grant execute on function public.admin_set_member_stock(text, uuid, integer, text) to authenticated;
grant execute on function public.admin_stock_history(integer, uuid) to authenticated;
