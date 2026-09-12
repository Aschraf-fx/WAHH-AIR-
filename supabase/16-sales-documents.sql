-- WAHH AIR Sales Documents: Quotation, Invoice, Receipt
-- Run once after existing migrations.

create table if not exists public.sales_document_settings (
  id smallint primary key default 1 check (id=1),
  logo_data_url text,
  company_name text,
  address text,
  phone text,
  email text,
  registration_no text,
  bank_name text,
  bank_account_name text,
  bank_account_no text,
  quotation_note text not null default 'Sebut harga ini dijana sepenuhnya oleh komputer dan tidak memerlukan tandatangan.',
  invoice_note text not null default 'Invois ini dijana sepenuhnya oleh komputer dan tidak memerlukan tandatangan.',
  receipt_note text not null default 'Resit ini dijana sepenuhnya oleh komputer dan tidak memerlukan tandatangan. Pembayaran seperti dinyatakan telah diterima.',
  default_deposit_percent numeric(5,2) not null default 50 check (default_deposit_percent between 0 and 100),
  default_deposit_days integer not null default 14 check (default_deposit_days >= 0),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.sales_document_settings(id) values(1) on conflict(id) do nothing;

create table if not exists public.sales_document_sequences (
  doc_type text not null check (doc_type in ('quotation','invoice','receipt')),
  doc_year integer not null,
  last_no integer not null default 0,
  primary key(doc_type,doc_year)
);

create table if not exists public.sales_documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('quotation','invoice','receipt')),
  doc_no text unique,
  status text not null,
  document_date date not null default current_date,
  customer_name text not null,
  customer_phone text,
  customer_address text,
  order_reference text,
  event_name text,
  event_date date,
  expiry_or_due_date date,
  deposit_enabled boolean not null default false,
  deposit_percent numeric(5,2) not null default 0 check (deposit_percent between 0 and 100),
  deposit_due_date date,
  extra_charge_description text,
  extra_charge_amount numeric(14,2) not null default 0 check (extra_charge_amount >= 0),
  subtotal numeric(14,2) not null default 0,
  grand_total numeric(14,2) not null default 0,
  notes text,
  terms text,
  header_snapshot jsonb not null default '{}'::jsonb,
  source_type text,
  source_id uuid,
  parent_quotation_id uuid references public.sales_documents(id) on delete set null,
  linked_invoice_id uuid references public.sales_documents(id) on delete set null,
  payment_id uuid,
  issued_at timestamptz,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete set null,
  cancellation_reason text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (doc_type='quotation' and status in ('draft','issued','accepted','rejected','expired')) or
    (doc_type='invoice' and status in ('draft','unpaid','partially_paid','paid','cancelled')) or
    (doc_type='receipt' and status in ('issued','cancelled'))
  )
);

create table if not exists public.sales_document_items (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.sales_documents(id) on delete cascade,
  line_no integer not null,
  description text not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(14,2) not null check (unit_price >= 0),
  line_amount numeric(14,2) generated always as (round((quantity*unit_price)::numeric,2)) stored,
  unique(document_id,line_no)
);

create table if not exists public.sales_document_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.sales_documents(id) on delete cascade,
  paid_at timestamptz not null default now(),
  amount numeric(14,2) not null check (amount > 0),
  method text,
  transaction_reference text,
  notes text,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_sales_documents_date on public.sales_documents(document_date desc);
create index if not exists idx_sales_documents_type_status on public.sales_documents(doc_type,status);
create index if not exists idx_sales_document_payments_invoice on public.sales_document_payments(invoice_id,paid_at);

alter table public.sales_document_settings enable row level security;
alter table public.sales_document_sequences enable row level security;
alter table public.sales_documents enable row level security;
alter table public.sales_document_items enable row level security;
alter table public.sales_document_payments enable row level security;
revoke all on table public.sales_document_settings,public.sales_document_sequences,public.sales_documents,public.sales_document_items,public.sales_document_payments from anon,authenticated;

create or replace function public.admin_sales_document_next_no(p_type text,p_date date)
returns text language plpgsql security definer set search_path='' as $$
declare v_year int; v_no int; v_prefix text;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_type not in ('quotation','invoice','receipt') then raise exception 'Jenis dokumen tidak sah'; end if;
  v_year:=extract(year from coalesce(p_date,current_date));
  v_prefix:=case p_type when 'quotation' then 'QUO' when 'invoice' then 'INV' else 'RCT' end;
  insert into public.sales_document_sequences(doc_type,doc_year,last_no) values(p_type,v_year,1)
  on conflict(doc_type,doc_year) do update set last_no=public.sales_document_sequences.last_no+1
  returning last_no into v_no;
  return v_prefix||'-'||v_year||'-'||lpad(v_no::text,4,'0');
end;$$;

create or replace function public.admin_get_sales_document_settings()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.is_admin() then to_jsonb(s) else null end from public.sales_document_settings s where id=1;
$$;

create or replace function public.admin_save_sales_document_settings(p_settings jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  update public.sales_document_settings set
    logo_data_url=nullif(p_settings->>'logo_data_url',''),
    company_name=nullif(trim(p_settings->>'company_name'),''),
    address=nullif(trim(p_settings->>'address'),''), phone=nullif(trim(p_settings->>'phone'),''),
    email=nullif(trim(p_settings->>'email'),''), registration_no=nullif(trim(p_settings->>'registration_no'),''),
    bank_name=nullif(trim(p_settings->>'bank_name'),''), bank_account_name=nullif(trim(p_settings->>'bank_account_name'),''), bank_account_no=nullif(trim(p_settings->>'bank_account_no'),''),
    quotation_note=coalesce(nullif(trim(p_settings->>'quotation_note'),''),quotation_note),
    invoice_note=coalesce(nullif(trim(p_settings->>'invoice_note'),''),invoice_note),
    receipt_note=coalesce(nullif(trim(p_settings->>'receipt_note'),''),receipt_note),
    default_deposit_percent=coalesce((p_settings->>'default_deposit_percent')::numeric,default_deposit_percent),
    default_deposit_days=coalesce((p_settings->>'default_deposit_days')::integer,default_deposit_days),
    updated_by=(select auth.uid()),updated_at=now() where id=1;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'SALES_DOC_SETTINGS_UPDATE','sales_document_settings','1','{}');
end;$$;

create or replace function public.admin_create_sales_document(p_doc jsonb,p_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_type text; v_status text; v_sub numeric:=0; v_total numeric; v_header jsonb; r jsonb; v_line int:=0;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  v_type:=p_doc->>'doc_type';
  if v_type not in ('quotation','invoice') then raise exception 'Cipta Quotation/Invoice sahaja melalui fungsi ini'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Sekurang-kurangnya satu item diperlukan'; end if;
  v_status:='draft';
  select jsonb_build_object('logo_data_url',logo_data_url,'company_name',company_name,'address',address,'phone',phone,'email',email,'registration_no',registration_no,'bank_name',bank_name,'bank_account_name',bank_account_name,'bank_account_no',bank_account_no) into v_header from public.sales_document_settings where id=1;
  insert into public.sales_documents(doc_type,status,document_date,customer_name,customer_phone,customer_address,order_reference,event_name,event_date,expiry_or_due_date,deposit_enabled,deposit_percent,deposit_due_date,extra_charge_description,extra_charge_amount,notes,terms,header_snapshot,source_type,source_id,created_by,updated_by)
  values(v_type,v_status,coalesce((p_doc->>'document_date')::date,current_date),trim(p_doc->>'customer_name'),nullif(trim(p_doc->>'customer_phone'),''),nullif(trim(p_doc->>'customer_address'),''),nullif(trim(p_doc->>'order_reference'),''),nullif(trim(p_doc->>'event_name'),''),nullif(p_doc->>'event_date','')::date,nullif(p_doc->>'expiry_or_due_date','')::date,coalesce((p_doc->>'deposit_enabled')::boolean,false),coalesce((p_doc->>'deposit_percent')::numeric,0),nullif(p_doc->>'deposit_due_date','')::date,nullif(trim(p_doc->>'extra_charge_description'),''),round(coalesce((p_doc->>'extra_charge_amount')::numeric,0),2),nullif(trim(p_doc->>'notes'),''),nullif(trim(p_doc->>'terms'),''),coalesce(v_header,'{}'::jsonb),nullif(p_doc->>'source_type',''),nullif(p_doc->>'source_id','')::uuid,(select auth.uid()),(select auth.uid())) returning id into v_id;
  for r in select value from jsonb_array_elements(p_items) loop
    v_line:=v_line+1;
    insert into public.sales_document_items(document_id,line_no,description,quantity,unit_price) values(v_id,v_line,trim(r->>'description'),(r->>'quantity')::numeric,round((r->>'unit_price')::numeric,2));
    v_sub:=v_sub+round(((r->>'quantity')::numeric*(r->>'unit_price')::numeric)::numeric,2);
  end loop;
  select round(v_sub+extra_charge_amount,2) into v_total from public.sales_documents where id=v_id;
  update public.sales_documents set subtotal=round(v_sub,2),grand_total=v_total where id=v_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'SALES_DOC_CREATE','sales_document',v_id::text,jsonb_build_object('type',v_type,'total',v_total));
  return v_id;
end;$$;

create or replace function public.admin_issue_sales_document(p_document_id uuid)
returns text language plpgsql security definer set search_path='' as $$
declare d public.sales_documents%rowtype; v_no text;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select * into d from public.sales_documents where id=p_document_id for update;
  if not found then raise exception 'Dokumen tidak ditemui'; end if;
  if d.doc_type='receipt' then raise exception 'Resit dijana daripada pembayaran'; end if;
  if d.doc_no is null then v_no:=public.admin_sales_document_next_no(d.doc_type,d.document_date); else v_no:=d.doc_no; end if;
  update public.sales_documents set doc_no=v_no,status=case when doc_type='quotation' then 'issued' else 'unpaid' end,issued_at=coalesce(issued_at,now()),updated_by=(select auth.uid()),updated_at=now() where id=p_document_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'SALES_DOC_ISSUE','sales_document',p_document_id::text,jsonb_build_object('doc_no',v_no));
  return v_no;
end;$$;

create or replace function public.admin_convert_quotation_to_invoice(p_quotation_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare q public.sales_documents%rowtype; v_id uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select * into q from public.sales_documents where id=p_quotation_id and doc_type='quotation'; if not found then raise exception 'Quotation tidak ditemui'; end if;
  insert into public.sales_documents(doc_type,status,document_date,customer_name,customer_phone,customer_address,order_reference,event_name,event_date,expiry_or_due_date,deposit_enabled,deposit_percent,deposit_due_date,extra_charge_description,extra_charge_amount,subtotal,grand_total,notes,terms,header_snapshot,source_type,source_id,parent_quotation_id,created_by,updated_by)
  values('invoice','draft',current_date,q.customer_name,q.customer_phone,q.customer_address,q.order_reference,q.event_name,q.event_date,current_date+14,true,50,current_date+14,q.extra_charge_description,q.extra_charge_amount,q.subtotal,q.grand_total,q.notes,null,q.header_snapshot,q.source_type,q.source_id,q.id,(select auth.uid()),(select auth.uid())) returning id into v_id;
  insert into public.sales_document_items(document_id,line_no,description,quantity,unit_price) select v_id,line_no,description,quantity,unit_price from public.sales_document_items where document_id=q.id order by line_no;
  update public.sales_documents set status='accepted',linked_invoice_id=v_id,updated_by=(select auth.uid()),updated_at=now() where id=q.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'QUOTATION_TO_INVOICE','sales_document',v_id::text,jsonb_build_object('quotation_id',q.id));
  return v_id;
end;$$;

create or replace function public.admin_add_sales_document_payment(p_invoice_id uuid,p_amount numeric,p_paid_at timestamptz,p_method text,p_reference text,p_notes text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_total numeric; v_paid numeric;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_amount<=0 then raise exception 'Amaun pembayaran mesti lebih 0'; end if;
  if not exists(select 1 from public.sales_documents where id=p_invoice_id and doc_type='invoice' and status<>'cancelled') then raise exception 'Invoice aktif tidak ditemui'; end if;
  insert into public.sales_document_payments(invoice_id,paid_at,amount,method,transaction_reference,notes,created_by) values(p_invoice_id,coalesce(p_paid_at,now()),round(p_amount,2),nullif(trim(p_method),''),nullif(trim(p_reference),''),nullif(trim(p_notes),''),(select auth.uid())) returning id into v_id;
  select grand_total into v_total from public.sales_documents where id=p_invoice_id;
  select coalesce(sum(amount),0) into v_paid from public.sales_document_payments where invoice_id=p_invoice_id;
  update public.sales_documents set status=case when v_paid<=0 then 'unpaid' when v_paid<v_total then 'partially_paid' else 'paid' end,updated_by=(select auth.uid()),updated_at=now() where id=p_invoice_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'INVOICE_PAYMENT_ADD','sales_document',p_invoice_id::text,jsonb_build_object('payment_id',v_id,'amount',p_amount));
  return v_id;
end;$$;

create or replace function public.admin_generate_receipt(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare p public.sales_document_payments%rowtype; i public.sales_documents%rowtype; v_id uuid; v_no text;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select * into p from public.sales_document_payments where id=p_payment_id; if not found then raise exception 'Pembayaran tidak ditemui'; end if;
  if exists(select 1 from public.sales_documents where doc_type='receipt' and payment_id=p_payment_id and status<>'cancelled') then select id into v_id from public.sales_documents where doc_type='receipt' and payment_id=p_payment_id and status<>'cancelled' limit 1; return v_id; end if;
  select * into i from public.sales_documents where id=p.invoice_id;
  v_no:=public.admin_sales_document_next_no('receipt',p.paid_at::date);
  insert into public.sales_documents(doc_type,doc_no,status,document_date,customer_name,customer_phone,customer_address,order_reference,event_name,event_date,extra_charge_amount,subtotal,grand_total,notes,header_snapshot,source_type,source_id,linked_invoice_id,payment_id,issued_at,created_by,updated_by)
  values('receipt',v_no,'issued',p.paid_at::date,i.customer_name,i.customer_phone,i.customer_address,i.order_reference,i.event_name,i.event_date,0,p.amount,p.amount,coalesce(p.notes,'Pembayaran diterima'),i.header_snapshot,i.source_type,i.source_id,i.id,p.id,now(),(select auth.uid()),(select auth.uid())) returning id into v_id;
  insert into public.sales_document_items(document_id,line_no,description,quantity,unit_price) values(v_id,1,'Pembayaran bagi Invoice '||coalesce(i.doc_no,'(Draf)'),1,p.amount);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'RECEIPT_GENERATE','sales_document',v_id::text,jsonb_build_object('payment_id',p_payment_id,'invoice_id',i.id));
  return v_id;
end;$$;

create or replace function public.admin_sales_document_list(p_search text default null,p_type text default null,p_status text default null,p_start date default null,p_end date default null)
returns table(id uuid,doc_type text,doc_no text,status text,document_date date,customer_name text,grand_total numeric,paid_amount numeric,balance numeric,due_date date,overdue boolean,parent_quotation_id uuid,linked_invoice_id uuid)
language sql stable security definer set search_path='' as $$
  select d.id,d.doc_type,d.doc_no,d.status,d.document_date,d.customer_name,d.grand_total,
    case when d.doc_type='invoice' then coalesce((select sum(p.amount) from public.sales_document_payments p where p.invoice_id=d.id),0) when d.doc_type='receipt' then d.grand_total else 0 end,
    case when d.doc_type='invoice' then greatest(d.grand_total-coalesce((select sum(p.amount) from public.sales_document_payments p where p.invoice_id=d.id),0),0) else 0 end,
    d.expiry_or_due_date,
    (d.doc_type='invoice' and d.status in ('unpaid','partially_paid') and d.expiry_or_due_date is not null and d.expiry_or_due_date<current_date),d.parent_quotation_id,d.linked_invoice_id
  from public.sales_documents d where public.is_admin()
    and (p_search is null or d.customer_name ilike '%'||p_search||'%' or coalesce(d.doc_no,'') ilike '%'||p_search||'%')
    and (p_type is null or d.doc_type=p_type) and (p_status is null or d.status=p_status)
    and (p_start is null or d.document_date>=p_start) and (p_end is null or d.document_date<=p_end)
  order by d.created_at desc;
$$;

create or replace function public.admin_get_sales_document(p_document_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.is_admin() then jsonb_build_object(
    'document',to_jsonb(d),
    'items',coalesce((select jsonb_agg(to_jsonb(x) order by x.line_no) from public.sales_document_items x where x.document_id=d.id),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.paid_at) from public.sales_document_payments p where p.invoice_id=d.id),'[]'::jsonb)
  ) else null end from public.sales_documents d where d.id=p_document_id;
$$;

create or replace function public.admin_cancel_sales_document(p_document_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare v_type text;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then raise exception 'Sebab pembatalan diperlukan'; end if;
  select doc_type into v_type from public.sales_documents where id=p_document_id; if not found then raise exception 'Dokumen tidak ditemui'; end if;
  if v_type='quotation' then update public.sales_documents set status='rejected',cancellation_reason=trim(p_reason),cancelled_at=now(),cancelled_by=(select auth.uid()),updated_by=(select auth.uid()),updated_at=now() where id=p_document_id;
  elsif v_type='invoice' then update public.sales_documents set status='cancelled',cancellation_reason=trim(p_reason),cancelled_at=now(),cancelled_by=(select auth.uid()),updated_by=(select auth.uid()),updated_at=now() where id=p_document_id;
  else update public.sales_documents set status='cancelled',cancellation_reason=trim(p_reason),cancelled_at=now(),cancelled_by=(select auth.uid()),updated_by=(select auth.uid()),updated_at=now() where id=p_document_id; end if;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details) values((select auth.uid()),'SALES_DOC_CANCEL','sales_document',p_document_id::text,jsonb_build_object('reason',trim(p_reason)));
end;$$;

revoke execute on function public.admin_sales_document_next_no(text,date) from public;
revoke execute on function public.admin_get_sales_document_settings() from public;
revoke execute on function public.admin_save_sales_document_settings(jsonb) from public;
revoke execute on function public.admin_create_sales_document(jsonb,jsonb) from public;
revoke execute on function public.admin_issue_sales_document(uuid) from public;
revoke execute on function public.admin_convert_quotation_to_invoice(uuid) from public;
revoke execute on function public.admin_add_sales_document_payment(uuid,numeric,timestamptz,text,text,text) from public;
revoke execute on function public.admin_generate_receipt(uuid) from public;
revoke execute on function public.admin_sales_document_list(text,text,text,date,date) from public;
revoke execute on function public.admin_get_sales_document(uuid) from public;
revoke execute on function public.admin_cancel_sales_document(uuid,text) from public;
grant execute on function public.admin_get_sales_document_settings() to authenticated;
grant execute on function public.admin_save_sales_document_settings(jsonb) to authenticated;
grant execute on function public.admin_create_sales_document(jsonb,jsonb) to authenticated;
grant execute on function public.admin_issue_sales_document(uuid) to authenticated;
grant execute on function public.admin_convert_quotation_to_invoice(uuid) to authenticated;
grant execute on function public.admin_add_sales_document_payment(uuid,numeric,timestamptz,text,text,text) to authenticated;
grant execute on function public.admin_generate_receipt(uuid) to authenticated;
grant execute on function public.admin_sales_document_list(text,text,text,date,date) to authenticated;
grant execute on function public.admin_get_sales_document(uuid) to authenticated;
grant execute on function public.admin_cancel_sales_document(uuid,text) to authenticated;
