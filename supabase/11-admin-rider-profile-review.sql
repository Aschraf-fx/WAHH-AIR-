-- Admin-only Rider identity review for cross-check.
-- Does not alter account, stock, sales, invoice or accounting logic.

create or replace function public.admin_get_rider_profile(p_public_id text)
returns table(
  public_id text,
  full_name text,
  phone text,
  status text,
  created_at timestamptz,
  ic_number text,
  profile_photo_path text,
  terms_text text,
  terms_accepted_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  return query
  select
    p.public_id,
    p.full_name,
    p.phone,
    p.status,
    p.created_at,
    ra.ic_number,
    ra.profile_photo_path,
    ra.terms_text,
    ra.terms_accepted_at
  from public.profiles p
  left join public.rider_applications ra on ra.user_id = p.id
  where p.public_id = p_public_id
    and p.role = 'rider'
  limit 1;
end;
$$;

revoke execute on function public.admin_get_rider_profile(text) from public;
grant execute on function public.admin_get_rider_profile(text) to authenticated;

drop policy if exists "admin read rider profile photos" on storage.objects;
create policy "admin read rider profile photos"
on storage.objects for select to authenticated
using (bucket_id='rider-profiles' and public.is_admin());
