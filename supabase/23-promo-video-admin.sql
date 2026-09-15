-- WAHH AIR: admin-managed portrait promo video for public landing page

create table if not exists public.promo_videos (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  storage_path text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.promo_videos enable row level security;

revoke all on table public.promo_videos from anon, authenticated;
grant select on public.promo_videos to anon, authenticated;
grant insert, update, delete on public.promo_videos to authenticated;

drop policy if exists "public active promo videos" on public.promo_videos;
create policy "public active promo videos"
on public.promo_videos for select to anon, authenticated
using (active = true or public.is_admin());

drop policy if exists "admin insert promo videos" on public.promo_videos;
create policy "admin insert promo videos"
on public.promo_videos for insert to authenticated
with check (public.is_admin());

drop policy if exists "admin update promo videos" on public.promo_videos;
create policy "admin update promo videos"
on public.promo_videos for update to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "admin delete promo videos" on public.promo_videos;
create policy "admin delete promo videos"
on public.promo_videos for delete to authenticated
using (public.is_admin());

insert into storage.buckets(id, name, public)
values ('promo-videos', 'promo-videos', true)
on conflict (id) do update set public = true;

drop policy if exists "public read promo videos bucket" on storage.objects;
create policy "public read promo videos bucket"
on storage.objects for select to anon, authenticated
using (bucket_id = 'promo-videos');

drop policy if exists "admin upload promo videos bucket" on storage.objects;
create policy "admin upload promo videos bucket"
on storage.objects for insert to authenticated
with check (bucket_id = 'promo-videos' and public.is_admin());

drop policy if exists "admin update promo videos bucket" on storage.objects;
create policy "admin update promo videos bucket"
on storage.objects for update to authenticated
using (bucket_id = 'promo-videos' and public.is_admin())
with check (bucket_id = 'promo-videos' and public.is_admin());

drop policy if exists "admin delete promo videos bucket" on storage.objects;
create policy "admin delete promo videos bucket"
on storage.objects for delete to authenticated
using (bucket_id = 'promo-videos' and public.is_admin());

create index if not exists promo_videos_active_created_idx
on public.promo_videos(active, created_at desc);
