-- WAHH AIR Sales Documents polish
-- Run after 16-sales-documents.sql

create or replace function public.admin_convert_quotation_to_invoice(p_quotation_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  q public.sales_documents%rowtype;
  s public.sales_document_settings%rowtype;
  v_id uuid;
  v_pct numeric;
  v_days integer;
  v_due date;
  v_terms text;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select * into q from public.sales_documents where id=p_quotation_id and doc_type='quotation';
  if not found then raise exception 'Quotation tidak ditemui'; end if;
  if q.status not in ('issued','accepted') then raise exception 'Quotation mesti dikeluarkan dahulu'; end if;
  select * into s from public.sales_document_settings where id=1;
  v_pct:=coalesce(s.default_deposit_percent,50);
  v_days:=coalesce(s.default_deposit_days,14);
  v_due:=current_date+v_days;
  v_terms:=coalesce(s.invoice_note,'Invois ini dijana sepenuhnya oleh komputer dan tidak memerlukan tandatangan.')||E'\n\n'||
    'Sekiranya pihak tuan/puan bersetuju dengan tempahan ini, bayaran deposit sebanyak '||trim(to_char(v_pct,'FM999990.##'))||'% daripada jumlah keseluruhan hendaklah dibuat dalam tempoh '||v_days||' hari dari tarikh invois dikeluarkan, iaitu selewat-lewatnya pada '||to_char(v_due,'DD/MM/YYYY')||'.';

  insert into public.sales_documents(
    doc_type,status,document_date,customer_name,customer_phone,customer_address,order_reference,event_name,event_date,
    expiry_or_due_date,deposit_enabled,deposit_percent,deposit_due_date,extra_charge_description,extra_charge_amount,
    subtotal,grand_total,notes,terms,header_snapshot,source_type,source_id,parent_quotation_id,created_by,updated_by
  ) values(
    'invoice','draft',current_date,q.customer_name,q.customer_phone,q.customer_address,q.order_reference,q.event_name,q.event_date,
    v_due,(v_pct>0),v_pct,v_due,q.extra_charge_description,q.extra_charge_amount,q.subtotal,q.grand_total,q.notes,v_terms,
    q.header_snapshot,q.source_type,q.source_id,q.id,(select auth.uid()),(select auth.uid())
  ) returning id into v_id;

  insert into public.sales_document_items(document_id,line_no,description,quantity,unit_price)
  select v_id,line_no,description,quantity,unit_price from public.sales_document_items where document_id=q.id order by line_no;

  update public.sales_documents set status='accepted',linked_invoice_id=v_id,updated_by=(select auth.uid()),updated_at=now() where id=q.id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'QUOTATION_TO_INVOICE','sales_document',v_id::text,jsonb_build_object('quotation_id',q.id,'deposit_percent',v_pct,'deposit_due',v_due));
  return v_id;
end;$$;

create or replace function public.admin_generate_receipt(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  p public.sales_document_payments%rowtype;
  i public.sales_documents%rowtype;
  s public.sales_document_settings%rowtype;
  v_id uuid;
  v_no text;
  v_note text;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select * into p from public.sales_document_payments where id=p_payment_id;
  if not found then raise exception 'Pembayaran tidak ditemui'; end if;
  if exists(select 1 from public.sales_documents where doc_type='receipt' and payment_id=p_payment_id and status<>'cancelled') then
    select id into v_id from public.sales_documents where doc_type='receipt' and payment_id=p_payment_id and status<>'cancelled' limit 1;
    return v_id;
  end if;
  select * into i from public.sales_documents where id=p.invoice_id;
  select * into s from public.sales_document_settings where id=1;
  v_no:=public.admin_sales_document_next_no('receipt',p.paid_at::date);
  v_note:=coalesce(s.receipt_note,'Resit ini dijana sepenuhnya oleh komputer dan tidak memerlukan tandatangan. Pembayaran seperti dinyatakan telah diterima.');
  if p.method is not null then v_note:=v_note||E'\nKaedah pembayaran: '||p.method||'.'; end if;
  if p.transaction_reference is not null then v_note:=v_note||E'\nRujukan transaksi: '||p.transaction_reference||'.'; end if;

  insert into public.sales_documents(
    doc_type,doc_no,status,document_date,customer_name,customer_phone,customer_address,order_reference,event_name,event_date,
    extra_charge_amount,subtotal,grand_total,notes,terms,header_snapshot,source_type,source_id,linked_invoice_id,payment_id,issued_at,created_by,updated_by
  ) values(
    'receipt',v_no,'issued',p.paid_at::date,i.customer_name,i.customer_phone,i.customer_address,i.order_reference,i.event_name,i.event_date,
    0,p.amount,p.amount,coalesce(p.notes,'Pembayaran diterima'),v_note,i.header_snapshot,i.source_type,i.source_id,i.id,p.id,now(),(select auth.uid()),(select auth.uid())
  ) returning id into v_id;

  insert into public.sales_document_items(document_id,line_no,description,quantity,unit_price)
  values(v_id,1,'Pembayaran diterima bagi Invoice '||coalesce(i.doc_no,'(Draf)'),1,p.amount);
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'RECEIPT_GENERATE','sales_document',v_id::text,jsonb_build_object('payment_id',p_payment_id,'invoice_id',i.id,'invoice_no',i.doc_no));
  return v_id;
end;$$;

create or replace function public.admin_set_sales_document_status(p_document_id uuid,p_status text)
returns void language plpgsql security definer set search_path='' as $$
declare d public.sales_documents%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  select * into d from public.sales_documents where id=p_document_id;
  if not found then raise exception 'Dokumen tidak ditemui'; end if;
  if d.doc_type='quotation' and p_status not in ('draft','issued','accepted','rejected','expired') then raise exception 'Status quotation tidak sah'; end if;
  if d.doc_type='invoice' and p_status not in ('draft','unpaid','partially_paid','paid','cancelled') then raise exception 'Status invoice tidak sah'; end if;
  if d.doc_type='receipt' and p_status not in ('issued','cancelled') then raise exception 'Status resit tidak sah'; end if;
  update public.sales_documents set status=p_status,updated_by=(select auth.uid()),updated_at=now() where id=p_document_id;
  insert into public.audit_logs(actor_id,action,entity_type,entity_id,details)
  values((select auth.uid()),'SALES_DOC_STATUS','sales_document',p_document_id::text,jsonb_build_object('from',d.status,'to',p_status));
end;$$;

revoke execute on function public.admin_set_sales_document_status(uuid,text) from public;
grant execute on function public.admin_set_sales_document_status(uuid,text) to authenticated;
