-- WAHH AIR Event Commission Ledger
-- Run after 12-event-management.sql (and safe after 13-event-stock-and-editing.sql)

create or replace function public.admin_event_commission_ledger()
returns table(
  commission_id uuid,
  event_id uuid,
  event_name text,
  event_date date,
  contact_name text,
  contact_phone text,
  recipient_name text,
  rate_per_bottle numeric,
  quantity integer,
  amount numeric,
  status text,
  paid_at timestamptz,
  notes text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    c.id,
    e.id,
    e.event_name,
    e.event_date,
    e.customer_name,
    e.customer_phone,
    c.recipient_name,
    c.rate_per_bottle,
    c.quantity,
    c.amount,
    c.status,
    c.paid_at,
    c.notes
  from public.event_commissions c
  join public.event_orders e on e.id = c.event_id
  where public.is_admin()
  order by e.event_date desc, c.created_at desc;
$$;

revoke execute on function public.admin_event_commission_ledger() from public, anon;
grant execute on function public.admin_event_commission_ledger() to authenticated;
