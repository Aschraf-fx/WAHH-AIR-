-- WAHH AIR Social Media / TikTok OAuth connection
-- Run after migration 20.
-- OAuth access/refresh tokens are server-side only. No anon/authenticated grants or RLS policies expose this table.

create table if not exists public.social_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('tiktok')),
  account_id uuid references public.social_accounts(id) on delete cascade,
  open_id text not null,
  union_id text,
  display_name text,
  avatar_url text,
  access_token text not null,
  refresh_token text not null,
  scopes text[] not null default '{}',
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  connected_by uuid references auth.users(id),
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(platform, open_id)
);

create index if not exists social_oauth_connections_platform_idx
  on public.social_oauth_connections(platform, updated_at desc);

alter table public.social_oauth_connections enable row level security;

-- Intentionally NO authenticated policy. Only server-side service-role code may read/write OAuth tokens.
revoke all on public.social_oauth_connections from anon;
revoke all on public.social_oauth_connections from authenticated;

-- Ensure TikTok account metadata remains available to server-side integration while tokens stay separate.
create unique index if not exists social_accounts_platform_external_uidx
  on public.social_accounts(platform, external_account_id)
  where external_account_id is not null;
