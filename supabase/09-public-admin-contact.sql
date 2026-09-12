-- Public contact endpoint for the Program Ejen page.
-- Exposes only the active Admin's display name and phone number.

create or replace function public.get_public_admin_contact()
returns table(full_name text, phone text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.full_name, p.phone
  from public.profiles p
  where p.role='admin'
    and p.status='active'
    and p.phone is not null
    and trim(p.phone) <> ''
  order by p.created_at
  limit 1;
$$;

revoke all on function public.get_public_admin_contact() from public;
grant execute on function public.get_public_admin_contact() to anon, authenticated;
