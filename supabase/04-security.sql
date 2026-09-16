-- WAHH AIR setup part 4/4: RLS, grants and Storage policies
-- -------------------------
-- RLS + grants
-- -------------------------
alter table public.profiles enable row level security;
alter table public.stock_locations enable row level security;
alter table public.flavours enable row level security;
alter table public.inventory_balances enable row level security;
alter table public.stock_movements enable row level security;
alter table public.materials enable row level security;
alter table public.recipes enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.commission_rules enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.invoices enable row level security;
alter table public.expenses enable row level security;
alter table public.partners enable row level security;
alter table public.partner_distributions enable row level security;
alter table public.partner_distribution_lines enable row level security;
alter table public.partner_withdrawals enable row level security;
alter table public.posters enable row level security;
alter table public.audit_logs enable row level security;

revoke all on table public.profiles,public.stock_locations,public.inventory_balances,public.stock_movements,public.sales,public.sale_items,public.invoices,public.audit_logs from anon,authenticated;
revoke all on table public.flavours,public.materials,public.recipes,public.purchases,public.purchase_items,public.commission_rules,public.expenses,public.partners,public.partner_distributions,public.partner_distribution_lines,public.partner_withdrawals,public.posters from anon,authenticated;

grant select on public.profiles to authenticated;
grant select on public.flavours to anon,authenticated;
grant select,insert,update,delete on public.flavours to authenticated;
grant select,insert,update,delete on public.materials,public.recipes,public.expenses,public.partners,public.partner_withdrawals,public.posters to authenticated;
grant select on public.purchases,public.purchase_items to authenticated;

drop policy if exists "own profile read" on public.profiles;
create policy "own profile read" on public.profiles for select to authenticated using ((select auth.uid())=id);

drop policy if exists "public active flavours" on public.flavours;
create policy "public active flavours" on public.flavours for select to anon,authenticated using (active=true or public.is_admin());
drop policy if exists "admin insert flavours" on public.flavours;
create policy "admin insert flavours" on public.flavours for insert to authenticated with check (public.is_admin());
drop policy if exists "admin update flavours" on public.flavours;
create policy "admin update flavours" on public.flavours for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin delete flavours" on public.flavours;
create policy "admin delete flavours" on public.flavours for delete to authenticated using (public.is_admin());

do $$
declare t text;
begin
  foreach t in array array['materials','recipes','expenses','partners','partner_withdrawals','posters'] loop
    execute format('drop policy if exists "admin select %1$s" on public.%1$I',t);
    execute format('create policy "admin select %1$s" on public.%1$I for select to authenticated using (public.is_admin())',t);
    execute format('drop policy if exists "admin insert %1$s" on public.%1$I',t);
    execute format('create policy "admin insert %1$s" on public.%1$I for insert to authenticated with check (public.is_admin())',t);
    execute format('drop policy if exists "admin update %1$s" on public.%1$I',t);
    execute format('create policy "admin update %1$s" on public.%1$I for update to authenticated using (public.is_admin()) with check (public.is_admin())',t);
    execute format('drop policy if exists "admin delete %1$s" on public.%1$I',t);
    execute format('create policy "admin delete %1$s" on public.%1$I for delete to authenticated using (public.is_admin())',t);
  end loop;
end$$;

drop policy if exists "public active posters" on public.posters;
create policy "public active posters" on public.posters for select to anon,authenticated using (active=true or public.is_admin());

revoke execute on all functions in schema public from public;
grant execute on function public.is_admin() to anon,authenticated;
grant execute on function public.is_active_user() to authenticated;
grant execute on function public.get_public_members() to anon,authenticated;
grant execute on function public.get_public_flavour_stock() to anon,authenticated;
grant execute on function public.get_public_member_stock() to authenticated;
grant execute on function public.get_my_stock() to authenticated;
grant execute on function public.get_my_dashboard() to authenticated;
grant execute on function public.get_my_sales(integer) to authenticated;
grant execute on function public.get_my_commission_summary() to authenticated;
grant execute on function public.update_my_profile(text,text) to authenticated;
grant execute on function public.finalize_sale(jsonb,text) to authenticated;
grant execute on function public.admin_list_members() to authenticated;
grant execute on function public.admin_set_member_status(text,text) to authenticated;
grant execute on function public.admin_stock_summary() to authenticated;
grant execute on function public.admin_adjust_hq_stock(uuid,integer,text) to authenticated;
grant execute on function public.admin_produce_stock(uuid,integer,text) to authenticated;
grant execute on function public.admin_allocate_stock(text,uuid,integer) to authenticated;
grant execute on function public.admin_return_stock(text,uuid,integer) to authenticated;
grant execute on function public.admin_get_member_stock(text) to authenticated;
grant execute on function public.admin_finalize_sale(text,jsonb,text) to authenticated;
grant execute on function public.admin_sales_list(integer) to authenticated;
grant execute on function public.admin_set_commission_status(text,text) to authenticated;
grant execute on function public.admin_void_invoice(text,text) to authenticated;
grant execute on function public.admin_invoice_list(integer) to authenticated;
grant execute on function public.admin_get_invoice(text) to authenticated;
grant execute on function public.admin_record_material_purchase(uuid,numeric,numeric,text,text) to authenticated;
grant execute on function public.admin_purchase_history(integer) to authenticated;
grant execute on function public.admin_accounting_summary(date,date) to authenticated;
grant execute on function public.admin_dashboard_summary() to authenticated;
grant execute on function public.admin_partner_profit_preview(date,date) to authenticated;
grant execute on function public.admin_create_partner_distribution(date,date,numeric) to authenticated;
grant execute on function public.admin_distribution_history(integer) to authenticated;
grant execute on function public.admin_audit_list(integer) to authenticated;

insert into storage.buckets(id,name,public) values('posters','posters',true)
on conflict (id) do update set public=true;

drop policy if exists "public read posters bucket" on storage.objects;
create policy "public read posters bucket" on storage.objects for select to anon,authenticated using (bucket_id='posters');
drop policy if exists "admin upload posters bucket" on storage.objects;
create policy "admin upload posters bucket" on storage.objects for insert to authenticated with check (bucket_id='posters' and public.is_admin());
drop policy if exists "admin update posters bucket" on storage.objects;
create policy "admin update posters bucket" on storage.objects for update to authenticated using (bucket_id='posters' and public.is_admin()) with check (bucket_id='posters' and public.is_admin());
drop policy if exists "admin delete posters bucket" on storage.objects;
create policy "admin delete posters bucket" on storage.objects for delete to authenticated using (bucket_id='posters' and public.is_admin());

-- Promote the first Admin manually AFTER registering a normal account:
-- update public.profiles p
-- set role='admin', public_id='WA-000001'
-- from auth.users u
-- where p.id=u.id and u.email='YOUR_ADMIN_EMAIL';
-- update public.stock_locations sl set location_code='WA-000001', name='WAHH AIR Admin', active=false
-- from public.profiles p where sl.user_id=p.id and p.public_id='WA-000001';
