-- Add poster categories so public promo posters and Rider/Ejen recruitment posters stay separate.
-- Safe to run once on the existing project.

alter table public.posters
  add column if not exists category text not null default 'promo';

update public.posters
set category='promo'
where category is null or category not in ('promo','recruitment');

alter table public.posters
  drop constraint if exists posters_category_check;

alter table public.posters
  add constraint posters_category_check
  check (category in ('promo','recruitment'));

create index if not exists idx_posters_category_active_sort
  on public.posters(category,active,sort_order,created_at desc);
