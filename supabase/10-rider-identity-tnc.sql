-- Rider identity + T&C records.
-- This migration does not change stock, sales, invoice or accounting logic.

create table if not exists public.rider_applications (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  ic_number text not null,
  profile_photo_path text not null,
  terms_text text not null,
  terms_accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (ic_number ~ '^[0-9]{12}$')
);

alter table public.rider_applications enable row level security;
revoke all on table public.rider_applications from anon, authenticated;
grant select on table public.rider_applications to authenticated;

drop policy if exists "rider application own read" on public.rider_applications;
create policy "rider application own read"
on public.rider_applications for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "admin read rider applications" on public.rider_applications;
create policy "admin read rider applications"
on public.rider_applications for select to authenticated
using (public.is_admin());

-- Formal Rider photos are private. Upload uses a short-lived signed upload token
-- created by the serverless endpoint; there is no anonymous public read policy.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values(
  'rider-profiles',
  'rider-profiles',
  false,
  5242880,
  array['image/jpeg','image/png','image/webp']
)
on conflict (id) do update set
  public=false,
  file_size_limit=5242880,
  allowed_mime_types=array['image/jpeg','image/png','image/webp'];

-- New Rider registrations must carry the identity/T&C metadata.
-- Agent registration remains unchanged.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_role text;
  v_public text;
  v_name text;
  v_ic text;
  v_photo text;
  v_terms text;
begin
  v_role := lower(coalesce(new.raw_user_meta_data->>'role','rider'));
  if v_role not in ('rider','agent') then v_role := 'rider'; end if;
  v_name := nullif(trim(coalesce(new.raw_user_meta_data->>'full_name','')), '');
  if v_name is null then v_name := 'WAHH AIR User'; end if;

  if v_role='rider' then
    v_ic := regexp_replace(coalesce(new.raw_user_meta_data->>'ic_number',''),'[^0-9]','','g');
    v_photo := nullif(trim(coalesce(new.raw_user_meta_data->>'profile_photo_path','')), '');
    v_terms := nullif(trim(coalesce(new.raw_user_meta_data->>'rider_terms_text','')), '');

    if length(v_ic) <> 12
       or v_photo is null
       or v_terms is null
       or coalesce(new.raw_user_meta_data->>'rider_terms_accepted','false') <> 'true' then
      raise exception 'Rider identity, formal photo and T&C acceptance are required';
    end if;
  end if;

  if v_role='agent' then
    v_public := 'WE-' || lpad(nextval('public.agent_public_seq')::text,6,'0');
  else
    v_public := 'WR-' || lpad(nextval('public.rider_public_seq')::text,6,'0');
  end if;

  insert into public.profiles(id,public_id,full_name,phone,role)
  values(new.id,v_public,v_name,nullif(trim(coalesce(new.raw_user_meta_data->>'phone','')),''),v_role);

  insert into public.stock_locations(location_code,name,location_type,user_id)
  values(v_public,v_name,'user',new.id);

  if v_role='rider' then
    insert into public.rider_applications(user_id,ic_number,profile_photo_path,terms_text,terms_accepted_at)
    values(new.id,v_ic,v_photo,v_terms,now());
  end if;

  return new;
end;$$;
