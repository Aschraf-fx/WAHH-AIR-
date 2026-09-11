-- Targeted fix: allow anonymous/public landing page users to read active poster rows.
-- RLS policy already limits anon reads to active=true; this grant was missing.

grant select on table public.posters to anon;
