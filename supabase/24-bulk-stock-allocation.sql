-- WAHH AIR: atomic multi-flavour stock allocation for one Rider/Ejen
create or replace function public.admin_allocate_stock_bulk(
  p_public_id text,
  p_items jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item jsonb;
  v_flavour_id uuid;
  v_quantity integer;
  seen_ids uuid[] := '{}'::uuid[];
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_public_id is null or btrim(p_public_id) = '' then
    raise exception 'Rider/Ejen diperlukan';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Sekurang-kurangnya satu flavour diperlukan';
  end if;

  for item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_flavour_id := (item->>'flavour_id')::uuid;
      v_quantity := (item->>'quantity')::integer;
    exception when others then
      raise exception 'Format item agihan tidak sah';
    end;

    if v_flavour_id is null or v_quantity is null or v_quantity < 1 then
      raise exception 'Flavour dan kuantiti mesti sah';
    end if;

    if v_flavour_id = any(seen_ids) then
      raise exception 'Flavour yang sama tidak boleh diagihkan dua kali';
    end if;
    seen_ids := array_append(seen_ids, v_flavour_id);

    perform public.admin_allocate_stock(
      p_public_id,
      v_flavour_id,
      v_quantity
    );
  end loop;
end;
$$;

revoke all on function public.admin_allocate_stock_bulk(text,jsonb) from public;
grant execute on function public.admin_allocate_stock_bulk(text,jsonb) to authenticated;
