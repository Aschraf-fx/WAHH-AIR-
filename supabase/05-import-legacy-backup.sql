-- ============================================================
-- WAHH AIR! Legacy Backup Import
-- Source: wahh-air-backup schemaVersion 2
-- Run ONCE in Supabase SQL Editor AFTER 01..04 + ADMIN_SETUP.
-- Safe to re-run: historical invoices/expenses/withdrawals/audit rows
-- are guarded against duplicates where practical.
--
-- IMPORTANT:
-- - Legacy Firebase Auth users are NOT recreated here. Passwords are not
--   portable and should never be imported.
-- - Historical sales are preserved for Admin accounting/invoices using
--   LEGACY-* seller IDs. They do NOT reduce current stock again.
-- - Legacy commission payment status was not stored, so imported
--   commissions remain PENDING until Admin decides otherwise.
-- ============================================================

begin;

-- Preserve the legacy RM0.05 overhead as a proper cost component without
-- making it an inventory item that production must physically consume.
alter table public.flavours
  add column if not exists overhead_per_unit numeric(12,4) not null default 0
  check (overhead_per_unit >= 0);

create or replace function public.calculate_flavour_cost(p_flavour_id uuid)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  v_recipe_cost numeric;
  v_manual numeric;
  v_overhead numeric;
begin
  select coalesce(sum(r.qty_required * m.avg_unit_cost),0)
  into v_recipe_cost
  from public.recipes r
  join public.materials m on m.id=r.material_id
  where r.flavour_id=p_flavour_id;

  select manual_unit_cogs,coalesce(overhead_per_unit,0)
  into v_manual,v_overhead
  from public.flavours
  where id=p_flavour_id;

  if coalesce(v_recipe_cost,0) <= 0 then
    return round(coalesce(v_manual,0)::numeric,4);
  end if;

  return round((v_recipe_cost + coalesce(v_overhead,0))::numeric,4);
end;$$;

-- Legacy sell price was RM7 for all products in this backup.
insert into public.flavours(name,slug,selling_price,manual_unit_cogs,overhead_per_unit,active,public_visible)
values ('Honeydew','honeydew',7,1.4063469388,0.05,true,true)
on conflict (slug) do update set name=excluded.name,selling_price=excluded.selling_price,manual_unit_cogs=excluded.manual_unit_cogs,overhead_per_unit=excluded.overhead_per_unit,active=excluded.active,public_visible=excluded.public_visible;

insert into public.flavours(name,slug,selling_price,manual_unit_cogs,overhead_per_unit,active,public_visible)
values ('Kopi Kaw','kopi-kaw',7,1.4083877551,0.05,true,true)
on conflict (slug) do update set name=excluded.name,selling_price=excluded.selling_price,manual_unit_cogs=excluded.manual_unit_cogs,overhead_per_unit=excluded.overhead_per_unit,active=excluded.active,public_visible=excluded.public_visible;

insert into public.flavours(name,slug,selling_price,manual_unit_cogs,overhead_per_unit,active,public_visible)
values ('Jagung','jagung',7,1.3880000000,0.05,true,true)
on conflict (slug) do update set name=excluded.name,selling_price=excluded.selling_price,manual_unit_cogs=excluded.manual_unit_cogs,overhead_per_unit=excluded.overhead_per_unit,active=excluded.active,public_visible=excluded.public_visible;

insert into public.flavours(name,slug,selling_price,manual_unit_cogs,overhead_per_unit,active,public_visible)
values ('Blueberry','blueberry',7,1.3880000000,0.05,true,true)
on conflict (slug) do update set name=excluded.name,selling_price=excluded.selling_price,manual_unit_cogs=excluded.manual_unit_cogs,overhead_per_unit=excluded.overhead_per_unit,active=excluded.active,public_visible=excluded.public_visible;

insert into public.flavours(name,slug,selling_price,manual_unit_cogs,overhead_per_unit,active,public_visible)
values ('Extra Joss Anggur','extra-joss-anggur',7,6.6680000000,0.05,false,false)
on conflict (slug) do update set name=excluded.name,selling_price=excluded.selling_price,manual_unit_cogs=excluded.manual_unit_cogs,overhead_per_unit=excluded.overhead_per_unit,active=excluded.active,public_visible=excluded.public_visible;

insert into public.flavours(name,slug,selling_price,manual_unit_cogs,overhead_per_unit,active,public_visible)
values ('Extra Joss Mangga','extra-joss-mangga',7,6.6680000000,0.05,false,false)
on conflict (slug) do update set name=excluded.name,selling_price=excluded.selling_price,manual_unit_cogs=excluded.manual_unit_cogs,overhead_per_unit=excluded.overhead_per_unit,active=excluded.active,public_visible=excluded.public_visible;

-- Rider commission in the old backup was RM1.80 per bottle.
-- Agent commission is left unchanged because the backup did not contain an agent rate.
update public.commission_rules set mode='fixed',value=1.8,active=true,updated_at=now() where role='rider';

-- Current raw-stock snapshot from the old app.
insert into public.materials(name,unit,current_qty,avg_unit_cost,min_qty,active) values ('Botol 400ml','unit',40,0.753000000000,0,true)
on conflict (name) do update set unit=excluded.unit,current_qty=excluded.current_qty,avg_unit_cost=excluded.avg_unit_cost,active=true;
insert into public.materials(name,unit,current_qty,avg_unit_cost,min_qty,active) values ('Straw','unit',158,0.025000000000,0,true)
on conflict (name) do update set unit=excluded.unit,current_qty=excluded.current_qty,avg_unit_cost=excluded.avg_unit_cost,active=true;
insert into public.materials(name,unit,current_qty,avg_unit_cost,min_qty,active) values ('Susu Pekat','ml',2112,0.280000000000,0,true)
on conflict (name) do update set unit=excluded.unit,current_qty=excluded.current_qty,avg_unit_cost=excluded.avg_unit_cost,active=true;
insert into public.materials(name,unit,current_qty,avg_unit_cost,min_qty,active) values ('Serbuk Honeydew','unit',8,0.018346938776,0,true)
on conflict (name) do update set unit=excluded.unit,current_qty=excluded.current_qty,avg_unit_cost=excluded.avg_unit_cost,active=true;
insert into public.materials(name,unit,current_qty,avg_unit_cost,min_qty,active) values ('Serbuk Kopi Kaw','unit',4,0.020387755102,0,true)
on conflict (name) do update set unit=excluded.unit,current_qty=excluded.current_qty,avg_unit_cost=excluded.avg_unit_cost,active=true;
insert into public.materials(name,unit,current_qty,avg_unit_cost,min_qty,active) values ('Serbuk Jagung','unit',0,0,0,true)
on conflict (name) do update set unit=excluded.unit,current_qty=excluded.current_qty,avg_unit_cost=excluded.avg_unit_cost,active=true;
insert into public.materials(name,unit,current_qty,avg_unit_cost,min_qty,active) values ('Serbuk Blueberry','unit',0,0,0,true)
on conflict (name) do update set unit=excluded.unit,current_qty=excluded.current_qty,avg_unit_cost=excluded.avg_unit_cost,active=true;
insert into public.materials(name,unit,current_qty,avg_unit_cost,min_qty,active) values ('Extra Joss Anggur','unit',10,0.240000000000,0,true)
on conflict (name) do update set unit=excluded.unit,current_qty=excluded.current_qty,avg_unit_cost=excluded.avg_unit_cost,active=true;
insert into public.materials(name,unit,current_qty,avg_unit_cost,min_qty,active) values ('Extra Joss Mangga','unit',10,0.240000000000,0,true)
on conflict (name) do update set unit=excluded.unit,current_qty=excluded.current_qty,avg_unit_cost=excluded.avg_unit_cost,active=true;

-- Trackable recipe components. Water is intentionally not added as an inventory material because the legacy backup did not track water stock/cost.
-- Each recipe reproduces the legacy unit COGS when combined with overhead_per_unit.
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='honeydew' and m.name='Serbuk Honeydew' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,2 from public.flavours f,public.materials m where f.slug='honeydew' and m.name='Susu Pekat' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='honeydew' and m.name='Botol 400ml' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='honeydew' and m.name='Straw' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;

insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='kopi-kaw' and m.name='Serbuk Kopi Kaw' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,2 from public.flavours f,public.materials m where f.slug='kopi-kaw' and m.name='Susu Pekat' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='kopi-kaw' and m.name='Botol 400ml' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='kopi-kaw' and m.name='Straw' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;

insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='jagung' and m.name='Serbuk Jagung' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,2 from public.flavours f,public.materials m where f.slug='jagung' and m.name='Susu Pekat' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='jagung' and m.name='Botol 400ml' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='jagung' and m.name='Straw' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;

insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='blueberry' and m.name='Serbuk Blueberry' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,2 from public.flavours f,public.materials m where f.slug='blueberry' and m.name='Susu Pekat' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='blueberry' and m.name='Botol 400ml' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='blueberry' and m.name='Straw' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;

insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='extra-joss-anggur' and m.name='Extra Joss Anggur' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,20 from public.flavours f,public.materials m where f.slug='extra-joss-anggur' and m.name='Susu Pekat' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='extra-joss-anggur' and m.name='Botol 400ml' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='extra-joss-anggur' and m.name='Straw' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;

insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='extra-joss-mangga' and m.name='Extra Joss Mangga' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,20 from public.flavours f,public.materials m where f.slug='extra-joss-mangga' and m.name='Susu Pekat' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='extra-joss-mangga' and m.name='Botol 400ml' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;
insert into public.recipes(flavour_id,material_id,qty_required) select f.id,m.id,1 from public.flavours f,public.materials m where f.slug='extra-joss-mangga' and m.name='Straw' on conflict (flavour_id,material_id) do update set qty_required=excluded.qty_required;

-- Partner split from the old backup: Wan / Husein 50:50.
update public.partners set name='Wan',share_percent=50,active=true where name='Partner 1';
update public.partners set name='Husein',share_percent=50,active=true where name='Partner 2';
insert into public.partners(name,share_percent,active) select 'Wan',50,true where not exists(select 1 from public.partners where lower(name)='wan');
insert into public.partners(name,share_percent,active) select 'Husein',50,true where not exists(select 1 from public.partners where lower(name)='husein');

insert into public.partner_withdrawals(partner_id,amount,notes,withdrawn_at,created_by)
select p.id,44.15,'Imported from legacy backup','2026-09-06T17:15:49.768Z'::timestamptz,null from public.partners p where lower(p.name)='husein'
and not exists(select 1 from public.partner_withdrawals pw where pw.partner_id=p.id and pw.amount=44.15 and pw.withdrawn_at='2026-09-06T17:15:49.768Z'::timestamptz and coalesce(pw.notes,'')='Imported from legacy backup');
insert into public.partner_withdrawals(partner_id,amount,notes,withdrawn_at,created_by)
select p.id,102.89,'Imported from legacy backup','2026-09-06T17:15:22.426Z'::timestamptz,null from public.partners p where lower(p.name)='wan'
and not exists(select 1 from public.partner_withdrawals pw where pw.partner_id=p.id and pw.amount=102.89 and pw.withdrawn_at='2026-09-06T17:15:22.426Z'::timestamptz and coalesce(pw.notes,'')='Imported from legacy backup');

-- Positive legacy expense adjustments. Zero-value rows are skipped because they have no P&L effect.
insert into public.expenses(category,description,amount,incurred_at,created_by)
select 'Legacy Adjustment','Pelarasan: Pelarasan Baru',17.66,'2026-09-06T17:17:48.208Z'::timestamptz,null
where not exists(select 1 from public.expenses where category='Legacy Adjustment' and amount=17.66 and incurred_at='2026-09-06T17:17:48.208Z'::timestamptz);
insert into public.expenses(category,description,amount,incurred_at,created_by)
select 'Legacy Adjustment','Pelarasan: Pelarasan Baru',12.90,'2026-09-06T17:17:17.840Z'::timestamptz,null
where not exists(select 1 from public.expenses where category='Legacy Adjustment' and amount=12.90 and incurred_at='2026-09-06T17:17:17.840Z'::timestamptz);

-- Historical sales + Admin-only legacy settlement invoices.
-- They do NOT change current inventory because the old current-stock snapshot already reflects them.

do $$
declare v_sale uuid; v_payload jsonb;
begin
if not exists(select 1 from public.invoices where invoice_no='LEGACY-20260907-0001') then
  insert into public.sales(seller_id,created_by,sale_date,status,total_amount,total_cogs,commission_amount,net_to_business,commission_status,notes,finalized_at,created_at)
  values(null,null,'2026-09-07T08:01:04.018Z','finalized',196.00,39.15,50.40,145.60,'pending','Imported legacy sale 1788768064018-pr6rf378f0a','2026-09-07T08:01:04.018Z','2026-09-07T08:01:04.018Z') returning id into v_sale;
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,9,7,1.4063469388,63,12.66,'2026-09-07T08:01:04.018Z' from public.flavours where slug='honeydew';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,6,7,1.4083877551,42,8.45,'2026-09-07T08:01:04.018Z' from public.flavours where slug='kopi-kaw';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,4,7,1.388,28,5.55,'2026-09-07T08:01:04.018Z' from public.flavours where slug='jagung';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,9,7,1.388,63,12.49,'2026-09-07T08:01:04.018Z' from public.flavours where slug='blueberry';
  select jsonb_build_object('items',jsonb_agg(jsonb_build_object('flavour_name',f.name,'quantity',si.quantity,'unit_price',si.unit_price,'line_total',si.line_total,'unit_cogs',si.unit_cogs)),'notes','Imported legacy sale 1788768064018-pr6rf378f0a; legacy email aiman@wahh.com','legacy_email','aiman@wahh.com','legacy_source_id','1788768064018-pr6rf378f0a','combo_sets',0,'combo_qty',3,'combo_price',18) into v_payload from public.sale_items si join public.flavours f on f.id=si.flavour_id where si.sale_id=v_sale;
  insert into public.invoices(invoice_no,sale_id,seller_public_id,seller_name,seller_role,sale_date,total_sales,commission_amount,net_to_business,payload,status,created_at)
  values('LEGACY-20260907-0001',v_sale,'LEGACY-AIMAN','Aiman','rider','2026-09-07T08:01:04.018Z',196,50.40,145.60,v_payload,'issued','2026-09-07T08:01:04.018Z');
end if; end$$;

do $$
declare v_sale uuid; v_payload jsonb;
begin
if not exists(select 1 from public.invoices where invoice_no='LEGACY-20260824-0002') then
  insert into public.sales(seller_id,created_by,sale_date,status,total_amount,total_cogs,commission_amount,net_to_business,commission_status,notes,finalized_at,created_at)
  values(null,null,'2026-08-24T12:00:00+08:00','finalized',137.00,27.95,36.00,101.00,'pending','Imported legacy sale 636abab9-e6ac-4575-bace-259554013f7e; combo 1 set x 3 @ RM18 (discount RM3.00)','2026-08-24T12:00:00+08:00','2026-08-24T12:00:00+08:00') returning id into v_sale;
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,5,7,1.388,32,6.94,'2026-08-24T12:00:00+08:00' from public.flavours where slug='jagung';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,5,7,1.4083877551,35,7.04,'2026-08-24T12:00:00+08:00' from public.flavours where slug='kopi-kaw';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,5,7,1.388,35,6.94,'2026-08-24T12:00:00+08:00' from public.flavours where slug='blueberry';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,5,7,1.4063469388,35,7.03,'2026-08-24T12:00:00+08:00' from public.flavours where slug='honeydew';
  select jsonb_build_object('items',jsonb_agg(jsonb_build_object('flavour_name',f.name,'quantity',si.quantity,'unit_price',si.unit_price,'line_total',si.line_total,'unit_cogs',si.unit_cogs)),'notes','Imported legacy sale 636abab9-e6ac-4575-bace-259554013f7e; combo 1x3 @ RM18; discount RM3 allocated to one line for accounting','legacy_email','aiman@wahh.com','legacy_source_id','636abab9-e6ac-4575-bace-259554013f7e','combo_sets',1,'combo_qty',3,'combo_price',18) into v_payload from public.sale_items si join public.flavours f on f.id=si.flavour_id where si.sale_id=v_sale;
  insert into public.invoices(invoice_no,sale_id,seller_public_id,seller_name,seller_role,sale_date,total_sales,commission_amount,net_to_business,payload,status,created_at)
  values('LEGACY-20260824-0002',v_sale,'LEGACY-AIMAN','Aiman','rider','2026-08-24T12:00:00+08:00',137,36,101,v_payload,'issued','2026-08-24T12:00:00+08:00');
end if; end$$;

do $$
declare v_sale uuid; v_payload jsonb;
begin
if not exists(select 1 from public.invoices where invoice_no='LEGACY-20260802-0003') then
  insert into public.sales(seller_id,created_by,sale_date,status,total_amount,total_cogs,commission_amount,net_to_business,commission_status,notes,finalized_at,created_at)
  values(null,null,'2026-08-02T12:00:00+08:00','finalized',112.00,22.36,28.80,83.20,'pending','Imported legacy sale b630e4a1-3614-43d3-8728-3a7ab33897df','2026-08-02T12:00:00+08:00','2026-08-02T12:00:00+08:00') returning id into v_sale;
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,4,7,1.4083877551,28,5.63,'2026-08-02T12:00:00+08:00' from public.flavours where slug='kopi-kaw';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,4,7,1.388,28,5.55,'2026-08-02T12:00:00+08:00' from public.flavours where slug='blueberry';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,4,7,1.4063469388,28,5.63,'2026-08-02T12:00:00+08:00' from public.flavours where slug='honeydew';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,4,7,1.388,28,5.55,'2026-08-02T12:00:00+08:00' from public.flavours where slug='jagung';
  select jsonb_build_object('items',jsonb_agg(jsonb_build_object('flavour_name',f.name,'quantity',si.quantity,'unit_price',si.unit_price,'line_total',si.line_total,'unit_cogs',si.unit_cogs)),'notes','Imported legacy sale b630e4a1-3614-43d3-8728-3a7ab33897df; legacy email haziq@wahh.com','legacy_email','haziq@wahh.com','legacy_source_id','b630e4a1-3614-43d3-8728-3a7ab33897df','combo_sets',0,'combo_qty',3,'combo_price',18) into v_payload from public.sale_items si join public.flavours f on f.id=si.flavour_id where si.sale_id=v_sale;
  insert into public.invoices(invoice_no,sale_id,seller_public_id,seller_name,seller_role,sale_date,total_sales,commission_amount,net_to_business,payload,status,created_at)
  values('LEGACY-20260802-0003',v_sale,'LEGACY-HAZIQ','Haziq','rider','2026-08-02T12:00:00+08:00',112,28.80,83.20,v_payload,'issued','2026-08-02T12:00:00+08:00');
end if; end$$;

do $$
declare v_sale uuid; v_payload jsonb;
begin
if not exists(select 1 from public.invoices where invoice_no='LEGACY-20260802-0004') then
  insert into public.sales(seller_id,created_by,sale_date,status,total_amount,total_cogs,commission_amount,net_to_business,commission_status,notes,finalized_at,created_at)
  values(null,null,'2026-08-02T12:00:00+08:00','finalized',112.00,22.36,28.80,83.20,'pending','Imported legacy sale 244a624a-70f6-4adb-8b78-5de58dfb73db','2026-08-02T12:00:00+08:00','2026-08-02T12:00:00+08:00') returning id into v_sale;
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,4,7,1.388,28,5.55,'2026-08-02T12:00:00+08:00' from public.flavours where slug='jagung';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,4,7,1.4083877551,28,5.63,'2026-08-02T12:00:00+08:00' from public.flavours where slug='kopi-kaw';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,4,7,1.4063469388,28,5.63,'2026-08-02T12:00:00+08:00' from public.flavours where slug='honeydew';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,4,7,1.388,28,5.55,'2026-08-02T12:00:00+08:00' from public.flavours where slug='blueberry';
  select jsonb_build_object('items',jsonb_agg(jsonb_build_object('flavour_name',f.name,'quantity',si.quantity,'unit_price',si.unit_price,'line_total',si.line_total,'unit_cogs',si.unit_cogs)),'notes','Imported legacy sale 244a624a-70f6-4adb-8b78-5de58dfb73db; legacy email aiman@wahh.com','legacy_email','aiman@wahh.com','legacy_source_id','244a624a-70f6-4adb-8b78-5de58dfb73db','combo_sets',0,'combo_qty',3,'combo_price',18) into v_payload from public.sale_items si join public.flavours f on f.id=si.flavour_id where si.sale_id=v_sale;
  insert into public.invoices(invoice_no,sale_id,seller_public_id,seller_name,seller_role,sale_date,total_sales,commission_amount,net_to_business,payload,status,created_at)
  values('LEGACY-20260802-0004',v_sale,'LEGACY-AIMAN','Aiman','rider','2026-08-02T12:00:00+08:00',112,28.80,83.20,v_payload,'issued','2026-08-02T12:00:00+08:00');
end if; end$$;

do $$
declare v_sale uuid; v_payload jsonb;
begin
if not exists(select 1 from public.invoices where invoice_no='LEGACY-20260726-0005') then
  insert into public.sales(seller_id,created_by,sale_date,status,total_amount,total_cogs,commission_amount,net_to_business,commission_status,notes,finalized_at,created_at)
  values(null,null,'2026-07-26T12:00:00+08:00','finalized',154.00,28.91,39.60,114.40,'pending','Imported legacy sale bad50e54-e756-40f4-90c6-2a5ec75a1bac','2026-07-26T12:00:00+08:00','2026-07-26T12:00:00+08:00') returning id into v_sale;
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,4,7,1.4208707483,28,5.68,'2026-07-26T12:00:00+08:00' from public.flavours where slug='kopi-kaw';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,7,7,1.3882176871,49,9.72,'2026-07-26T12:00:00+08:00' from public.flavours where slug='honeydew';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,6,7,1.228,42,7.37,'2026-07-26T12:00:00+08:00' from public.flavours where slug='extra-joss-mangga';
  insert into public.sale_items(sale_id,flavour_id,quantity,unit_price,unit_cogs,line_total,line_cogs,created_at) select v_sale,id,5,7,1.228,35,6.14,'2026-07-26T12:00:00+08:00' from public.flavours where slug='extra-joss-anggur';
  select jsonb_build_object('items',jsonb_agg(jsonb_build_object('flavour_name',f.name,'quantity',si.quantity,'unit_price',si.unit_price,'line_total',si.line_total,'unit_cogs',si.unit_cogs)),'notes','Imported legacy sale bad50e54-e756-40f4-90c6-2a5ec75a1bac; legacy email aiman@wahh.com','legacy_email','aiman@wahh.com','legacy_source_id','bad50e54-e756-40f4-90c6-2a5ec75a1bac','combo_sets',0,'combo_qty',3,'combo_price',18) into v_payload from public.sale_items si join public.flavours f on f.id=si.flavour_id where si.sale_id=v_sale;
  insert into public.invoices(invoice_no,sale_id,seller_public_id,seller_name,seller_role,sale_date,total_sales,commission_amount,net_to_business,payload,status,created_at)
  values('LEGACY-20260726-0005',v_sale,'LEGACY-AIMAN','aiman','rider','2026-07-26T12:00:00+08:00',154,39.60,114.40,v_payload,'issued','2026-07-26T12:00:00+08:00');
end if; end$$;

-- Prevent a legacy invoice from being voided through the normal stock-return flow because its seller stock location no longer exists.
create or replace function public.admin_void_invoice(p_invoice_no text,p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_sale public.sales%rowtype; v_loc uuid; r record;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Sebab void diperlukan'; end if;
  select s.* into v_sale from public.sales s join public.invoices i on i.sale_id=s.id where i.invoice_no=p_invoice_no and i.status='issued' for update of s;
  if not found then raise exception 'Invoice aktif tidak ditemui'; end if;
  if v_sale.seller_id is null then raise exception 'Invoice legacy tidak boleh void melalui stock-return biasa. Buat accounting adjustment jika perlu.'; end if;
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
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'INVOICE_VOID','invoice',p_invoice_no,jsonb_build_object('reason',trim(p_reason)));
end;$$;

-- Preserve old Firebase rider identities for later reference/linking.
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at)
select null,'LEGACY_RIDER_IMPORT','legacy_rider','Wex1daBwWabLd3bU4VlpIjyCGR42','{"legacy_uid":"Wex1daBwWabLd3bU4VlpIjyCGR42","name":"Haziq","email":"haziq@wahh.com","fee":1.8,"active":true}'::jsonb,now()
where not exists(select 1 from public.audit_logs where action='LEGACY_RIDER_IMPORT' and entity_id='Wex1daBwWabLd3bU4VlpIjyCGR42');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at)
select null,'LEGACY_RIDER_IMPORT','legacy_rider','d6REVa6jxFONVDqYrhFdO2SFZDh2','{"legacy_uid":"d6REVa6jxFONVDqYrhFdO2SFZDh2","name":"aiman","email":"aiman@wahh.com","fee":1.8,"active":true}'::jsonb,now()
where not exists(select 1 from public.audit_logs where action='LEGACY_RIDER_IMPORT' and entity_id='d6REVa6jxFONVDqYrhFdO2SFZDh2');

-- Preserve production batch history without replaying it into today's stock balance.
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','1788715166931-q720py721ij','{"legacy_id":"1788715166931-q720py721ij","flavour":"Blueberry","quantity":9,"cost":12.492}'::jsonb,'2026-09-06T17:19:26.931Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='1788715166931-q720py721ij');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','1788715162932-exw9iy9gqrg','{"legacy_id":"1788715162932-exw9iy9gqrg","flavour":"Jagung","quantity":4,"cost":5.5520000000000005}'::jsonb,'2026-09-06T17:19:22.933Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='1788715162932-exw9iy9gqrg');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','1788715152992-ovxj7hp9wd','{"legacy_id":"1788715152992-ovxj7hp9wd","flavour":"Kopi Kaw","quantity":2,"cost":2.816775510204082}'::jsonb,'2026-09-06T17:19:12.992Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='1788715152992-ovxj7hp9wd');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','1788715144943-xt2prxwxg2','{"legacy_id":"1788715144943-xt2prxwxg2","flavour":"Honeydew","quantity":1,"cost":1.40634693877551}'::jsonb,'2026-09-06T17:19:04.943Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='1788715144943-xt2prxwxg2');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','b795d2e6-d6b7-4e53-b654-14589fe02185','{"legacy_id":"b795d2e6-d6b7-4e53-b654-14589fe02185","flavour":"Honeydew","quantity":3,"cost":4.2190408163265305}'::jsonb,'2026-08-24T07:10:56.921Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='b795d2e6-d6b7-4e53-b654-14589fe02185');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','7e850be7-81ec-44eb-a7f1-3ed68a10f597','{"legacy_id":"7e850be7-81ec-44eb-a7f1-3ed68a10f597","flavour":"Honeydew","quantity":5,"cost":7.03173469387755}'::jsonb,'2026-08-24T07:10:46.167Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='7e850be7-81ec-44eb-a7f1-3ed68a10f597');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','e13c1b8d-202b-497d-ada2-fcbecc4030e3','{"legacy_id":"e13c1b8d-202b-497d-ada2-fcbecc4030e3","flavour":"Kopi Kaw","quantity":4,"cost":5.633551020408164}'::jsonb,'2026-08-24T07:10:41.155Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='e13c1b8d-202b-497d-ada2-fcbecc4030e3');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','f4a7e0d6-84f7-419a-8fbf-8353d1799d78','{"legacy_id":"f4a7e0d6-84f7-419a-8fbf-8353d1799d78","flavour":"Honeydew","quantity":8,"cost":64.20016326530613}'::jsonb,'2026-07-31T15:53:30.003Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='f4a7e0d6-84f7-419a-8fbf-8353d1799d78');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','671403cb-3a70-4424-97ab-3b31777f5057','{"legacy_id":"671403cb-3a70-4424-97ab-3b31777f5057","flavour":"Kopi Kaw","quantity":4,"cost":31.19232653061225}'::jsonb,'2026-07-31T15:53:21.313Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='671403cb-3a70-4424-97ab-3b31777f5057');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','10407d32-b11b-49fa-9b8c-3f7caad3db30','{"legacy_id":"10407d32-b11b-49fa-9b8c-3f7caad3db30","flavour":"Honeydew","quantity":1,"cost":1.5450204081632652}'::jsonb,'2026-07-26T13:42:20.554Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='10407d32-b11b-49fa-9b8c-3f7caad3db30');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_BATCH','batch','4406b159-810b-4039-b324-19a780fbb21a','{"legacy_id":"4406b159-810b-4039-b324-19a780fbb21a","flavour":"Honeydew","quantity":1,"cost":1.5450204081632652}'::jsonb,'2026-07-26T13:42:19.687Z' where not exists(select 1 from public.audit_logs where action='LEGACY_BATCH' and entity_id='4406b159-810b-4039-b324-19a780fbb21a');

-- Preserve old adjustment history without replaying it into current inventory.
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_ADJUSTMENT','stock_adjustment','1788715068208-atk41n9w2x','{"item":"f:kopi","before":872,"after":6,"reason":"Pelarasan Baru"}'::jsonb,'2026-09-06T17:17:48.208Z' where not exists(select 1 from public.audit_logs where action='LEGACY_ADJUSTMENT' and entity_id='1788715068208-atk41n9w2x');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_ADJUSTMENT','stock_adjustment','1788715056115-zodhdwt89','{"item":"f:jagung","before":980,"after":4,"reason":"Pelarasan Baru"}'::jsonb,'2026-09-06T17:17:36.115Z' where not exists(select 1 from public.audit_logs where action='LEGACY_ADJUSTMENT' and entity_id='1788715056115-zodhdwt89');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_ADJUSTMENT','stock_adjustment','1788715046156-konxyun3tif','{"item":"f:blueberry","before":980,"after":9,"reason":"Pelarasan Baru"}'::jsonb,'2026-09-06T17:17:26.156Z' where not exists(select 1 from public.audit_logs where action='LEGACY_ADJUSTMENT' and entity_id='1788715046156-konxyun3tif');
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at) select null,'LEGACY_ADJUSTMENT','stock_adjustment','1788715037840-gb75fbdjl24','{"item":"f:honeydew","before":712,"after":9,"reason":"Pelarasan Baru"}'::jsonb,'2026-09-06T17:17:17.840Z' where not exists(select 1 from public.audit_logs where action='LEGACY_ADJUSTMENT' and entity_id='1788715037840-gb75fbdjl24');

-- Preserve the old global settings, including combo 3 for RM18, for future feature migration.
insert into public.audit_logs(actor_id,action,entity_type,entity_id,details,created_at)
select null,'LEGACY_SETTINGS_IMPORT','settings','schema-v2','{"bottleVolumeMl":400,"sellPrice":7,"comboQty":3,"comboPrice":18,"riderFee":1.8,"bottleCost":0.753,"strawCost":0.025,"overheadCost":0.05,"milkCostPerMl":0.28}'::jsonb,now()
where not exists(select 1 from public.audit_logs where action='LEGACY_SETTINGS_IMPORT' and entity_id='schema-v2');

commit;

-- Expected imported historical accounting (before any NEW app activity):
-- Revenue: RM711.00
-- COGS: RM140.73 (per-sale monetary rounding)
-- Rider commission: RM183.60
-- Positive legacy expenses: RM30.56
-- Historical net profit contribution: RM356.11
--
-- Legacy partner withdrawals imported:
-- Wan RM102.89
-- Husein RM44.15
--
-- Current ready-stock snapshot in the backup was ZERO for every flavour,
-- so this migration intentionally does not add finished-product HQ stock.
