-- WAHH AIR Event finance consistency + dashboard totals
-- Run after 12, 13 and 14.
-- Cancelled events keep their original booking data for audit, but contribute RM0 to sales/revenue/profit.
-- Event costing is simplified to product cost per bottle + all additional event costs + commission.

-- Standardise existing event orders to the simple combined product-cost model.
update public.event_orders
set base_cost_mode='combined',
    base_unit_cost=case when coalesce(base_unit_cost,0)>0 then base_unit_cost else 0.74 end,
    updated_at=now()
where base_cost_mode<>'combined' or coalesce(base_unit_cost,0)=0;

create or replace function public.admin_event_recalculate_partner_shares(p_event_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_status text;
  v_net numeric;
  v_dist numeric;
  v_one numeric;
  v_two numeric;
  v_old_one numeric;
  v_old_two numeric;
  v_paid boolean;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;

  select e.status,
    case when e.status='cancelled' then 0 else round(
      (e.quantity*e.unit_price + e.customer_delivery_charge)
      - (e.quantity*e.base_unit_cost)
      - coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)
      - coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0)
    ,2) end
  into v_status,v_net
  from public.event_orders e where e.id=p_event_id;

  if v_net is null then raise exception 'Event tidak ditemui'; end if;
  v_dist:=greatest(v_net,0);
  v_one:=round(v_dist/2,2);
  v_two:=round(v_dist-v_one,2);

  select max(amount) filter(where partner_slot=1),max(amount) filter(where partner_slot=2),bool_or(status='paid')
    into v_old_one,v_old_two,v_paid from public.event_partner_shares where event_id=p_event_id;

  if coalesce(v_paid,false) and (coalesce(v_old_one,0)<>v_one or coalesce(v_old_two,0)<>v_two) then
    raise exception 'Bahagian partner sudah dibayar. Tandakan semula sebagai Belum Dibayar sebelum mengubah nilai kewangan event';
  end if;

  update public.event_partner_shares
  set amount=case when partner_slot=1 then v_one else v_two end,
      updated_at=now()
  where event_id=p_event_id;
end;$$;

create or replace function public.admin_event_list(
  p_search text default null,p_start date default null,p_end date default null,p_status text default null
)
returns table(
  id uuid,event_name text,customer_name text,event_date date,status text,quantity integer,unit_price numeric,
  drink_sales numeric,delivery_income numeric,total_income numeric,received numeric,balance_due numeric,total_cost numeric,total_commission numeric,net_profit numeric
) language sql stable security definer set search_path='' as $$
  select
    e.id,e.event_name,e.customer_name,e.event_date,e.status,e.quantity,e.unit_price,
    case when e.status='cancelled' then 0 else round(e.quantity*e.unit_price,2) end as drink_sales,
    case when e.status='cancelled' then 0 else round(e.customer_delivery_charge,2) end as delivery_income,
    case when e.status='cancelled' then 0 else round(e.quantity*e.unit_price+e.customer_delivery_charge,2) end as total_income,
    coalesce((select sum(p.amount) from public.event_payments p where p.event_id=e.id),0) as received,
    case when e.status='cancelled' then 0 else round(
      e.quantity*e.unit_price+e.customer_delivery_charge-coalesce((select sum(p.amount) from public.event_payments p where p.event_id=e.id),0),2
    ) end as balance_due,
    case when e.status='cancelled' then 0 else round(
      e.quantity*e.base_unit_cost + coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0),2
    ) end as total_cost,
    case when e.status='cancelled' then 0 else round(coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0),2) end as total_commission,
    case when e.status='cancelled' then 0 else round(
      (e.quantity*e.unit_price+e.customer_delivery_charge)
      - (e.quantity*e.base_unit_cost)
      - coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)
      - coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0),2
    ) end as net_profit
  from public.event_orders e
  where public.is_admin()
    and (p_search is null or e.event_name ilike '%'||p_search||'%' or e.customer_name ilike '%'||p_search||'%')
    and (p_start is null or e.event_date>=p_start)
    and (p_end is null or e.event_date<=p_end)
    and (p_status is null or e.status=p_status)
  order by e.event_date desc,e.created_at desc;
$$;

-- Accounting: only COMPLETED events become actual business revenue/profit.
create or replace function public.admin_accounting_summary(p_start date,p_end date)
returns table(revenue numeric,cogs numeric,gross_profit numeric,commission_expense numeric,operating_expenses numeric,net_profit numeric,stock_purchases numeric,inventory_value numeric)
language sql stable security definer set search_path = '' as $$
  with s as (
    select coalesce(sum(total_amount),0) revenue,coalesce(sum(total_cogs),0) cogs,coalesce(sum(commission_amount),0) comm
    from public.sales where status='finalized' and sale_date::date between p_start and p_end
  ), ev as (
    select
      coalesce(sum(e.quantity*e.unit_price+e.customer_delivery_charge),0) revenue,
      coalesce(sum(e.quantity*e.base_unit_cost + coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)),0) cogs,
      coalesce(sum(coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0)),0) comm
    from public.event_orders e
    where e.status='completed' and e.event_date between p_start and p_end
  ), x as (
    select coalesce(sum(amount),0) expenses from public.expenses where incurred_at::date between p_start and p_end
  ), p as (
    select coalesce(sum(total_cost),0) purchases from public.purchases where purchased_at::date between p_start and p_end
  ), raw as (
    select coalesce(sum(current_qty*avg_unit_cost),0) val from public.materials where active=true
  ), fin as (
    select coalesce(sum(ib.quantity*public.calculate_flavour_cost(ib.flavour_id)),0) val from public.inventory_balances ib
  )
  select (s.revenue+ev.revenue),(s.cogs+ev.cogs),(s.revenue+ev.revenue-s.cogs-ev.cogs),(s.comm+ev.comm),x.expenses,
         (s.revenue+ev.revenue-s.cogs-ev.cogs-s.comm-ev.comm-x.expenses),p.purchases,(raw.val+fin.val)
  from s,ev,x,p,raw,fin where public.is_admin();
$$;

-- Dashboard breakdown: Rider/Ejen sales, Completed Event sales, and combined totals.
create or replace function public.admin_business_dashboard_summary()
returns table(
  today_member_sales numeric,
  today_event_sales numeric,
  today_total_sales numeric,
  month_member_sales numeric,
  month_event_sales numeric,
  month_total_sales numeric,
  month_event_net_profit numeric,
  month_combined_net_profit numeric
) language sql stable security definer set search_path='' as $$
  with member_today as (
    select coalesce(sum(s.total_amount),0) v from public.sales s where s.status='finalized' and s.sale_date::date=current_date
  ), event_today as (
    select coalesce(sum(e.quantity*e.unit_price+e.customer_delivery_charge),0) v
    from public.event_orders e where e.status='completed' and e.event_date=current_date
  ), member_month as (
    select coalesce(sum(s.total_amount),0) v from public.sales s
    where s.status='finalized' and s.sale_date::date between date_trunc('month',current_date)::date and current_date
  ), event_month as (
    select coalesce(sum(e.quantity*e.unit_price+e.customer_delivery_charge),0) v
    from public.event_orders e where e.status='completed' and e.event_date between date_trunc('month',current_date)::date and current_date
  ), event_profit as (
    select coalesce(sum(
      (e.quantity*e.unit_price+e.customer_delivery_charge)
      - e.quantity*e.base_unit_cost
      - coalesce((select sum(c.amount) from public.event_costs c where c.event_id=e.id),0)
      - coalesce((select sum(c.amount) from public.event_commissions c where c.event_id=e.id),0)
    ),0) v
    from public.event_orders e where e.status='completed' and e.event_date between date_trunc('month',current_date)::date and current_date
  ), acct as (
    select * from public.admin_accounting_summary(date_trunc('month',current_date)::date,current_date)
  )
  select mt.v,et.v,mt.v+et.v,mm.v,em.v,mm.v+em.v,ep.v,coalesce(a.net_profit,0)
  from member_today mt,event_today et,member_month mm,event_month em,event_profit ep,acct a
  where public.is_admin();
$$;

revoke execute on function public.admin_business_dashboard_summary() from public;
grant execute on function public.admin_business_dashboard_summary() to authenticated;

grant execute on function public.admin_event_list(text,date,date,text) to authenticated;
grant execute on function public.admin_event_recalculate_partner_shares(uuid) to authenticated;
