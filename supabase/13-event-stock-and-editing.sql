-- WAHH AIR Event enhancements: stock usage + editable financial lines
-- Run after 12-event-management.sql

create table if not exists public.event_material_usages (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.event_orders(id) on delete cascade,
  material_id uuid not null references public.materials(id),
  material_name text not null,
  quantity numeric(16,4) not null check (quantity > 0),
  unit text not null,
  unit_cost_snapshot numeric(16,6) not null check (unit_cost_snapshot >= 0),
  amount numeric(14,2) generated always as (round((quantity*unit_cost_snapshot)::numeric,2)) stored,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists idx_event_material_usage_event on public.event_material_usages(event_id);
alter table public.event_material_usages enable row level security;
revoke all on table public.event_material_usages from anon,authenticated;

create or replace function public.admin_event_recalculate_partner_shares(p_event_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_net numeric;
  v_dist numeric;
  v_one numeric;
  v_two numeric;
  v_old_one numeric;
  v_old_two numeric;
  v_paid boolean;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select round(
    (e.quantity*e.unit_price + e.customer_delivery_charge)
    - (case when e.base_cost_mode='combined' then e.quantity*e.base_unit_cost else 0 end)
    - coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)
    - (case when e.base_cost_mode='itemized' then coalesce((select sum(u.amount) from public.event_material_usages u where u.event_id=e.id),0) else 0 end)
    - coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0)
  ,2) into v_net from public.event_orders e where e.id=p_event_id;
  if v_net is null then raise exception 'Event tidak ditemui'; end if;
  v_dist:=greatest(v_net,0); v_one:=round(v_dist/2,2); v_two:=round(v_dist-v_one,2);
  select max(amount) filter(where partner_slot=1),max(amount) filter(where partner_slot=2),bool_or(status='paid')
    into v_old_one,v_old_two,v_paid from public.event_partner_shares where event_id=p_event_id;
  if coalesce(v_paid,false) and (coalesce(v_old_one,0)<>v_one or coalesce(v_old_two,0)<>v_two) then
    raise exception 'Bahagian partner sudah dibayar. Tandakan semula sebagai Belum Dibayar sebelum mengubah nilai kewangan event';
  end if;
  update public.event_partner_shares set amount=case when partner_slot=1 then v_one else v_two end,updated_at=now() where event_id=p_event_id;
end;$$;

-- Safer create function: partner names always have fallbacks even if partner setup is incomplete.
create or replace function public.admin_create_event(
  p_event_name text,p_customer_name text,p_customer_phone text,p_event_date date,p_location text,
  p_quantity integer,p_unit_price numeric,p_delivery_charge numeric default 0,p_notes text default null,
  p_status text default 'pending',p_base_cost_mode text default 'combined',p_base_unit_cost numeric default 0.74
) returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_p1 uuid; v_p2 uuid; v_n1 text; v_n2 text;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_quantity<200 then raise exception 'Minimum tempahan event ialah 200 botol'; end if;
  if p_unit_price<0 or coalesce(p_delivery_charge,0)<0 or coalesce(p_base_unit_cost,0)<0 then raise exception 'Nilai wang tidak sah'; end if;
  if p_status not in ('pending','confirmed','completed','cancelled') then raise exception 'Status event tidak sah'; end if;
  if p_base_cost_mode not in ('combined','itemized') then raise exception 'Mode kos tidak sah'; end if;
  insert into public.event_orders(event_name,customer_name,customer_phone,event_date,location,quantity,unit_price,customer_delivery_charge,notes,status,base_cost_mode,base_unit_cost,created_by,updated_by)
  values(trim(p_event_name),trim(p_customer_name),nullif(trim(coalesce(p_customer_phone,'')),''),p_event_date,nullif(trim(coalesce(p_location,'')),''),p_quantity,round(p_unit_price,2),round(coalesce(p_delivery_charge,0),2),nullif(trim(coalesce(p_notes,'')),''),p_status,p_base_cost_mode,p_base_unit_cost,(select auth.uid()),(select auth.uid())) returning id into v_id;
  select id,name into v_p1,v_n1 from public.partners where active=true order by created_at,id limit 1;
  select id,name into v_p2,v_n2 from public.partners where active=true and id is distinct from v_p1 order by created_at,id limit 1;
  insert into public.event_partner_shares(event_id,partner_slot,partner_id,partner_name,share_percent)
  values(v_id,1,v_p1,coalesce(v_n1,'Partner 1'),50),(v_id,2,v_p2,coalesce(v_n2,'Partner 2'),50);
  perform public.admin_event_recalculate_partner_shares(v_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_CREATE','event',v_id::text,jsonb_build_object('event_name',trim(p_event_name),'quantity',p_quantity,'unit_price',p_unit_price));
  return v_id;
end;$$;

create or replace function public.admin_add_event_material_usage(p_event_id uuid,p_material_id uuid,p_quantity numeric,p_notes text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_name text; v_unit text; v_cost numeric; v_stock numeric;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_quantity<=0 then raise exception 'Quantity penggunaan mesti lebih daripada 0'; end if;
  perform 1 from public.event_orders where id=p_event_id; if not found then raise exception 'Event tidak ditemui'; end if;
  select name,unit,avg_unit_cost,current_qty into v_name,v_unit,v_cost,v_stock from public.materials where id=p_material_id and active=true for update;
  if not found then raise exception 'Bahan/stok tidak ditemui'; end if;
  if v_stock<p_quantity then raise exception 'Stok tidak mencukupi. Baki: % %',v_stock,v_unit; end if;
  insert into public.event_material_usages(event_id,material_id,material_name,quantity,unit,unit_cost_snapshot,notes,created_by)
  values(p_event_id,p_material_id,v_name,p_quantity,v_unit,v_cost,nullif(trim(coalesce(p_notes,'')),''),(select auth.uid())) returning id into v_id;
  update public.materials set current_qty=current_qty-p_quantity,updated_at=now() where id=p_material_id;
  perform public.admin_event_recalculate_partner_shares(p_event_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_STOCK_USE','event',p_event_id::text,jsonb_build_object('usage_id',v_id,'material',v_name,'quantity',p_quantity,'unit_cost',v_cost));
  return v_id;
end;$$;

create or replace function public.admin_remove_event_material_usage(p_usage_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare r public.event_material_usages%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select * into r from public.event_material_usages where id=p_usage_id for update; if not found then raise exception 'Penggunaan stok tidak ditemui'; end if;
  update public.materials set current_qty=current_qty+r.quantity,updated_at=now() where id=r.material_id;
  delete from public.event_material_usages where id=p_usage_id;
  perform public.admin_event_recalculate_partner_shares(r.event_id);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_STOCK_USE_REMOVE','event',r.event_id::text,jsonb_build_object('usage_id',p_usage_id,'quantity',r.quantity));
end;$$;

create or replace function public.admin_update_event_cost(p_cost_id uuid,p_category text,p_description text,p_amount numeric)
returns void language plpgsql security definer set search_path='' as $$
declare v_event uuid; v_mode text;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select c.event_id,e.base_cost_mode into v_event,v_mode from public.event_costs c join public.event_orders e on e.id=c.event_id where c.id=p_cost_id;
  if not found then raise exception 'Kos tidak ditemui'; end if;
  if p_category not in ('beverage_material','bottle','ice','cooler_box','delivery','packaging','other') then raise exception 'Kategori kos tidak sah'; end if;
  if v_mode='combined' and p_category in ('beverage_material','bottle') then raise exception 'Kos gabungan bahan + botol sedang digunakan'; end if;
  if p_amount<0 then raise exception 'Kos tidak sah'; end if;
  update public.event_costs set category=p_category,description=nullif(trim(coalesce(p_description,'')),''),amount=round(p_amount,2) where id=p_cost_id;
  perform public.admin_event_recalculate_partner_shares(v_event);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_COST_UPDATE','event',v_event::text,jsonb_build_object('cost_id',p_cost_id,'amount',p_amount));
end;$$;

create or replace function public.admin_delete_event_cost(p_cost_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  delete from public.event_costs where id=p_cost_id returning event_id into v_event; if not found then raise exception 'Kos tidak ditemui'; end if;
  perform public.admin_event_recalculate_partner_shares(v_event);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_COST_DELETE','event',v_event::text,jsonb_build_object('cost_id',p_cost_id));
end;$$;

create or replace function public.admin_update_event_commission(p_commission_id uuid,p_recipient_name text,p_rate numeric,p_quantity integer,p_notes text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_rate<0 or p_quantity<=0 then raise exception 'Kadar / quantity tidak sah'; end if;
  update public.event_commissions set recipient_name=trim(p_recipient_name),rate_per_bottle=p_rate,quantity=p_quantity,notes=nullif(trim(coalesce(p_notes,'')),'') where id=p_commission_id returning event_id into v_event;
  if not found then raise exception 'Komisen tidak ditemui'; end if;
  perform public.admin_event_recalculate_partner_shares(v_event);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_COMMISSION_UPDATE','event',v_event::text,jsonb_build_object('commission_id',p_commission_id));
end;$$;

create or replace function public.admin_delete_event_commission(p_commission_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  delete from public.event_commissions where id=p_commission_id returning event_id into v_event; if not found then raise exception 'Komisen tidak ditemui'; end if;
  perform public.admin_event_recalculate_partner_shares(v_event);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_COMMISSION_DELETE','event',v_event::text,jsonb_build_object('commission_id',p_commission_id));
end;$$;

create or replace function public.admin_delete_event_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_event uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  delete from public.event_payments where id=p_payment_id returning event_id into v_event; if not found then raise exception 'Bayaran tidak ditemui'; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'EVENT_PAYMENT_DELETE','event',v_event::text,jsonb_build_object('payment_id',p_payment_id));
end;$$;

create or replace function public.admin_event_list(p_search text default null,p_start date default null,p_end date default null,p_status text default null)
returns table(id uuid,event_name text,customer_name text,event_date date,status text,quantity integer,unit_price numeric,drink_sales numeric,delivery_income numeric,total_income numeric,received numeric,balance_due numeric,total_cost numeric,total_commission numeric,net_profit numeric)
language sql stable security definer set search_path='' as $$
  select e.id,e.event_name,e.customer_name,e.event_date,e.status,e.quantity,e.unit_price,
    round(e.quantity*e.unit_price,2),e.customer_delivery_charge,round(e.quantity*e.unit_price+e.customer_delivery_charge,2),
    coalesce((select sum(p.amount) from public.event_payments p where p.event_id=e.id),0),
    round((e.quantity*e.unit_price+e.customer_delivery_charge)-coalesce((select sum(p.amount) from public.event_payments p where p.event_id=e.id),0),2),
    round((case when e.base_cost_mode='combined' then e.quantity*e.base_unit_cost else 0 end)+coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)+(case when e.base_cost_mode='itemized' then coalesce((select sum(u.amount) from public.event_material_usages u where u.event_id=e.id),0) else 0 end),2),
    coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0),
    round((e.quantity*e.unit_price+e.customer_delivery_charge)-(case when e.base_cost_mode='combined' then e.quantity*e.base_unit_cost else 0 end)-coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)-(case when e.base_cost_mode='itemized' then coalesce((select sum(u.amount) from public.event_material_usages u where u.event_id=e.id),0) else 0 end)-coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0),2)
  from public.event_orders e where public.is_admin()
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
    'stock_usage',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from public.event_material_usages x where x.event_id=e.id),'[]'::jsonb),
    'commissions',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at) from public.event_commissions x where x.event_id=e.id),'[]'::jsonb),
    'partners',coalesce((select jsonb_agg(to_jsonb(x) order by x.partner_slot) from public.event_partner_shares x where x.event_id=e.id),'[]'::jsonb)
  ) else null end from public.event_orders e where e.id=p_event_id;
$$;

create or replace function public.admin_accounting_summary(p_start date,p_end date)
returns table(revenue numeric,cogs numeric,gross_profit numeric,commission_expense numeric,operating_expenses numeric,net_profit numeric,stock_purchases numeric,inventory_value numeric)
language sql stable security definer set search_path = '' as $$
  with s as (select coalesce(sum(total_amount),0) revenue,coalesce(sum(total_cogs),0) cogs,coalesce(sum(commission_amount),0) comm from public.sales where status='finalized' and sale_date::date between p_start and p_end),
  ev as (select coalesce(sum(e.quantity*e.unit_price+e.customer_delivery_charge),0) revenue,
      coalesce(sum((case when e.base_cost_mode='combined' then e.quantity*e.base_unit_cost else 0 end)+coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)+(case when e.base_cost_mode='itemized' then coalesce((select sum(u.amount) from public.event_material_usages u where u.event_id=e.id),0) else 0 end)),0) cogs,
      coalesce(sum(coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0)),0) comm
    from public.event_orders e where e.status='completed' and e.event_date between p_start and p_end),
  x as (select coalesce(sum(amount),0) expenses from public.expenses where incurred_at::date between p_start and p_end),
  p as (select coalesce(sum(total_cost),0) purchases from public.purchases where purchased_at::date between p_start and p_end),
  raw as (select coalesce(sum(current_qty*avg_unit_cost),0) val from public.materials where active=true),
  fin as (select coalesce(sum(ib.quantity*public.calculate_flavour_cost(ib.flavour_id)),0) val from public.inventory_balances ib)
  select (s.revenue+ev.revenue),(s.cogs+ev.cogs),(s.revenue+ev.revenue-s.cogs-ev.cogs),(s.comm+ev.comm),x.expenses,(s.revenue+ev.revenue-s.cogs-ev.cogs-s.comm-ev.comm-x.expenses),p.purchases,(raw.val+fin.val)
  from s,ev,x,p,raw,fin where public.is_admin();
$$;

revoke execute on function public.admin_add_event_material_usage(uuid,uuid,numeric,text) from public;
revoke execute on function public.admin_remove_event_material_usage(uuid) from public;
revoke execute on function public.admin_update_event_cost(uuid,text,text,numeric) from public;
revoke execute on function public.admin_delete_event_cost(uuid) from public;
revoke execute on function public.admin_update_event_commission(uuid,text,numeric,integer,text) from public;
revoke execute on function public.admin_delete_event_commission(uuid) from public;
revoke execute on function public.admin_delete_event_payment(uuid) from public;
grant execute on function public.admin_add_event_material_usage(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.admin_remove_event_material_usage(uuid) to authenticated;
grant execute on function public.admin_update_event_cost(uuid,text,text,numeric) to authenticated;
grant execute on function public.admin_delete_event_cost(uuid) to authenticated;
grant execute on function public.admin_update_event_commission(uuid,text,numeric,integer,text) to authenticated;
grant execute on function public.admin_delete_event_commission(uuid) to authenticated;
grant execute on function public.admin_delete_event_payment(uuid) to authenticated;
