-- WAHH AIR 100ml Event stock visibility
-- Run after 23-product-variants-event-recipes.sql

create or replace function public.admin_event_variant_state(p_event_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.is_admin() then jsonb_build_object(
    'catalog',coalesce((
      select jsonb_agg(jsonb_build_object(
        'variant_id',v.id,'flavour_id',v.flavour_id,'flavour_name',f.name,'variant_name',v.name,
        'volume_ml',v.volume_ml,'channel',v.channel,
        'recipe_count',(select count(*) from public.variant_recipes r where r.variant_id=v.id)
      ) order by f.created_at)
      from public.product_variants v join public.flavours f on f.id=v.flavour_id
      where v.active=true and v.channel='event'
    ),'[]'::jsonb),
    'items',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',i.id,'variant_id',i.variant_id,'variant_name',v.name,'flavour_name',f.name,
        'volume_ml',v.volume_ml,'quantity',i.quantity
      ) order by f.created_at)
      from public.event_variant_items i
      join public.product_variants v on v.id=i.variant_id
      join public.flavours f on f.id=v.flavour_id
      where i.event_id=p_event_id
    ),'[]'::jsonb),
    'auto_usage',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',u.id,'material_id',u.material_id,'material_name',u.material_name,
        'quantity',u.quantity,'unit',u.unit,'unit_cost_snapshot',u.unit_cost_snapshot,
        'amount',u.amount,'created_at',u.created_at
      ) order by u.material_name)
      from public.event_material_usages u
      where u.event_id=p_event_id and u.usage_source='variant_recipe'
    ),'[]'::jsonb),
    'auto_usage_count',(select count(*) from public.event_material_usages u where u.event_id=p_event_id and u.usage_source='variant_recipe'),
    'synced_at',(select max(u.created_at) from public.event_material_usages u where u.event_id=p_event_id and u.usage_source='variant_recipe')
  ) end
  where exists(select 1 from public.event_orders e where e.id=p_event_id);
$$;

create or replace function public.admin_event_variant_consumption_list(p_limit integer default 100)
returns table(
  event_id uuid,event_name text,event_date date,event_status text,event_quantity integer,
  synced_at timestamptz,material_name text,quantity numeric,unit text,amount numeric
)
language sql stable security definer set search_path='' as $$
  select e.id,e.event_name,e.event_date,e.status,e.quantity,
    max(u.created_at) over(partition by e.id) as synced_at,
    u.material_name,u.quantity,u.unit,u.amount
  from public.event_orders e
  join public.event_material_usages u on u.event_id=e.id and u.usage_source='variant_recipe'
  where public.is_admin()
  order by max(u.created_at) over(partition by e.id) desc,e.event_date desc,u.material_name
  limit greatest(1,least(coalesce(p_limit,100),500));
$$;

grant execute on function public.admin_event_variant_state(uuid) to authenticated;
grant execute on function public.admin_event_variant_consumption_list(integer) to authenticated;
