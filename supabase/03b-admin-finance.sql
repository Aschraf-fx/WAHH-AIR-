-- WAHH AIR setup part 3B: invoice, accounting and partner RPCs
create or replace function public.admin_void_invoice(p_invoice_no text,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_sale public.sales%rowtype;
  v_loc uuid;
  r record;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Sebab void diperlukan'; end if;
  select s.* into v_sale from public.sales s join public.invoices i on i.sale_id=s.id where i.invoice_no=p_invoice_no and i.status='issued' for update of s;
  if not found then raise exception 'Invoice aktif tidak ditemui'; end if;
  if v_sale.status<>'finalized' then raise exception 'Sale bukan finalized'; end if;
  if v_sale.commission_status='paid' then raise exception 'Komisen sudah dibayar. Buat adjustment manual sebelum void'; end if;
  select id into v_loc from public.stock_locations where user_id=v_sale.seller_id and active=true;
  for r in select * from public.sale_items where sale_id=v_sale.id loop
    insert into public.inventory_balances(location_id,flavour_id,quantity) values(v_loc,r.flavour_id,0) on conflict do nothing;
    update public.inventory_balances set quantity=quantity+r.quantity,updated_at=now() where location_id=v_loc and flavour_id=r.flavour_id;
    insert into public.stock_movements(flavour_id,to_location_id,quantity,movement_type,reference_type,reference_id,reason,created_by)
    values(r.flavour_id,v_loc,r.quantity,'sale_void','sale',v_sale.id,'Void invoice '||p_invoice_no,(select auth.uid()));
  end loop;
  update public.sales set status='void',void_reason=trim(p_reason),voided_at=now(),voided_by=(select auth.uid()) where id=v_sale.id;
  update public.invoices set status='voided' where invoice_no=p_invoice_no;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'INVOICE_VOID','invoice',p_invoice_no,jsonb_build_object('reason',trim(p_reason)));
end;$$;

create or replace function public.admin_invoice_list(p_limit integer default 200)
returns table(invoice_no text,created_at timestamptz,seller_public_id text,seller_name text,status text,total_sales numeric,commission_amount numeric)
language sql stable security definer set search_path = '' as $$
  select i.invoice_no,i.created_at,i.seller_public_id,i.seller_name,i.status,i.total_sales,i.commission_amount
  from public.invoices i where public.is_admin() order by i.created_at desc limit greatest(1,least(coalesce(p_limit,200),1000));
$$;

create or replace function public.admin_get_invoice(p_invoice_no text)
returns table(invoice_no text,seller_public_id text,seller_name text,seller_role text,sale_date timestamptz,total_sales numeric,commission_amount numeric,net_to_business numeric,payload jsonb,status text)
language sql stable security definer set search_path = '' as $$
  select i.invoice_no,i.seller_public_id,i.seller_name,i.seller_role,i.sale_date,i.total_sales,i.commission_amount,i.net_to_business,i.payload,i.status
  from public.invoices i where public.is_admin() and i.invoice_no=p_invoice_no;
$$;

create or replace function public.admin_record_material_purchase(p_material_id uuid,p_quantity numeric,p_unit_cost numeric,p_supplier text default null,p_notes text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_purchase uuid; v_old_qty numeric; v_old_cost numeric; v_new_qty numeric; v_new_cost numeric; v_total numeric;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_quantity<=0 or p_unit_cost<0 then raise exception 'Quantity / cost tidak sah'; end if;
  select current_qty,avg_unit_cost into v_old_qty,v_old_cost from public.materials where id=p_material_id for update;
  if not found then raise exception 'Bahan tidak ditemui'; end if;
  v_total:=round(p_quantity*p_unit_cost,2);
  insert into public.purchases(supplier,total_cost,notes,created_by) values(p_supplier,v_total,p_notes,(select auth.uid())) returning id into v_purchase;
  insert into public.purchase_items(purchase_id,material_id,quantity,unit_cost) values(v_purchase,p_material_id,p_quantity,p_unit_cost);
  v_new_qty:=v_old_qty+p_quantity;
  if v_new_qty>0 then v_new_cost:=((v_old_qty*v_old_cost)+(p_quantity*p_unit_cost))/v_new_qty; else v_new_cost:=0; end if;
  update public.materials set current_qty=v_new_qty,avg_unit_cost=v_new_cost where id=p_material_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'MATERIAL_PURCHASE','purchase',v_purchase::text,jsonb_build_object('material_id',p_material_id,'quantity',p_quantity,'unit_cost',p_unit_cost,'total',v_total));
  return v_purchase;
end;$$;

create or replace function public.admin_purchase_history(p_limit integer default 100)
returns table(purchased_at timestamptz,material_name text,unit text,supplier text,quantity numeric,unit_cost numeric,total_cost numeric)
language sql stable security definer set search_path = '' as $$
  select p.purchased_at,m.name,m.unit,p.supplier,pi.quantity,pi.unit_cost,pi.total_cost
  from public.purchase_items pi join public.purchases p on p.id=pi.purchase_id join public.materials m on m.id=pi.material_id
  where public.is_admin() order by p.purchased_at desc limit greatest(1,least(coalesce(p_limit,100),1000));
$$;

create or replace function public.admin_accounting_summary(p_start date,p_end date)
returns table(revenue numeric,cogs numeric,gross_profit numeric,commission_expense numeric,operating_expenses numeric,net_profit numeric,stock_purchases numeric,inventory_value numeric)
language sql stable security definer set search_path = '' as $$
  with s as (
    select coalesce(sum(total_amount),0) revenue,coalesce(sum(total_cogs),0) cogs,coalesce(sum(commission_amount),0) comm
    from public.sales where status='finalized' and sale_date::date between p_start and p_end
  ), e as (
    select coalesce(sum(amount),0) expenses from public.expenses where incurred_at::date between p_start and p_end
  ), p as (
    select coalesce(sum(total_cost),0) purchases from public.purchases where purchased_at::date between p_start and p_end
  ), raw as (
    select coalesce(sum(current_qty*avg_unit_cost),0) val from public.materials where active=true
  ), fin as (
    select coalesce(sum(ib.quantity*public.calculate_flavour_cost(ib.flavour_id)),0) val from public.inventory_balances ib
  )
  select s.revenue,s.cogs,(s.revenue-s.cogs),s.comm,e.expenses,(s.revenue-s.cogs-s.comm-e.expenses),p.purchases,(raw.val+fin.val)
  from s,e,p,raw,fin where public.is_admin();
$$;

create or replace function public.admin_dashboard_summary()
returns table(today_sales numeric,today_units bigint,active_members bigint,total_stock bigint,month_revenue numeric,month_net_profit numeric)
language sql stable security definer set search_path = '' as $$
  with acct as (select * from public.admin_accounting_summary(date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month - 1 day')::date))
  select
    coalesce((select sum(total_amount) from public.sales where status='finalized' and sale_date::date=current_date),0),
    coalesce((select sum(si.quantity) from public.sale_items si join public.sales s on s.id=si.sale_id where s.status='finalized' and s.sale_date::date=current_date),0),
    (select count(*) from public.profiles where role in ('rider','agent') and status='active'),
    coalesce((select sum(quantity) from public.inventory_balances),0),
    coalesce((select revenue from acct),0),
    coalesce((select net_profit from acct),0)
  where public.is_admin();
$$;

create or replace function public.admin_partner_profit_preview(p_start date,p_end date)
returns table(net_profit numeric,reserve_amount numeric,distributable_profit numeric)
language sql stable security definer set search_path = '' as $$
  select a.net_profit,0::numeric,greatest(a.net_profit,0)
  from public.admin_accounting_summary(p_start,p_end) a where public.is_admin();
$$;

create or replace function public.admin_create_partner_distribution(p_start date,p_end date,p_reserve numeric default 0)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_net numeric; v_dist numeric; v_share numeric; v_id uuid; r record;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_end<p_start or p_reserve<0 then raise exception 'Tempoh / reserve tidak sah'; end if;
  select net_profit into v_net from public.admin_accounting_summary(p_start,p_end);
  select coalesce(sum(share_percent),0) into v_share from public.partners where active=true;
  if abs(v_share-100)>0.001 then raise exception 'Jumlah share partner aktif mesti 100%%. Sekarang %%%',v_share; end if;
  v_dist:=greatest(coalesce(v_net,0)-p_reserve,0);
  insert into public.partner_distributions(period_start,period_end,net_profit,reserve_amount,distributable_profit,created_by)
  values(p_start,p_end,coalesce(v_net,0),p_reserve,v_dist,(select auth.uid())) returning id into v_id;
  for r in select * from public.partners where active=true loop
    insert into public.partner_distribution_lines(distribution_id,partner_id,partner_name,share_percent,amount)
    values(v_id,r.id,r.name,r.share_percent,round(v_dist*r.share_percent/100,2));
  end loop;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'PARTNER_DISTRIBUTION','partner_distribution',v_id::text,jsonb_build_object('period_start',p_start,'period_end',p_end,'net_profit',v_net,'reserve',p_reserve,'distributable',v_dist));
  return v_id;
end;$$;

create or replace function public.admin_distribution_history(p_limit integer default 50)
returns table(period_start date,period_end date,net_profit numeric,reserve_amount numeric,distributable_profit numeric,status text)
language sql stable security definer set search_path = '' as $$
  select d.period_start,d.period_end,d.net_profit,d.reserve_amount,d.distributable_profit,d.status
  from public.partner_distributions d where public.is_admin() order by d.created_at desc limit greatest(1,least(coalesce(p_limit,50),500));
$$;

create or replace function public.admin_audit_list(p_limit integer default 250)
returns table(created_at timestamptz,actor_public_id text,action text,entity_type text,details_text text)
language sql stable security definer set search_path = '' as $$
  select a.created_at,p.public_id,a.action,a.entity_type,a.details::text
  from public.audit_logs a left join public.profiles p on p.id=a.actor_id
  where public.is_admin() order by a.created_at desc limit greatest(1,least(coalesce(p_limit,250),1000));
$$;
