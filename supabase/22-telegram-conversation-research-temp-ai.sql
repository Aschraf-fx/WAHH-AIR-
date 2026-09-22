-- WAHH AIR AI Office
-- Telegram conversation memory + temporary specialist agents.

create table if not exists public.telegram_ai_conversations (
  id uuid primary key default gen_random_uuid(),
  chat_id text not null unique,
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.telegram_ai_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.telegram_ai_conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text not null,
  message_type text not null default 'chat' check (message_type in ('chat','task','research','specialist','system')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists telegram_ai_messages_conversation_created_idx
  on public.telegram_ai_messages(conversation_id, created_at desc);

create table if not exists public.ai_temporary_agents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.telegram_ai_conversations(id) on delete set null,
  name text not null,
  purpose text not null,
  system_prompt text not null,
  model_name text,
  status text not null default 'active' check (status in ('active','expired','disabled')),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ai_temporary_agents_owner_status_idx
  on public.ai_temporary_agents(owner_id, status, expires_at desc);

alter table public.telegram_ai_conversations enable row level security;
alter table public.telegram_ai_messages enable row level security;
alter table public.ai_temporary_agents enable row level security;

revoke all on table public.telegram_ai_conversations from anon, authenticated;
revoke all on table public.telegram_ai_messages from anon, authenticated;
revoke all on table public.ai_temporary_agents from anon, authenticated;

comment on table public.telegram_ai_conversations is 'Server-side Telegram Chief AI conversation sessions.';
comment on table public.telegram_ai_messages is 'Short conversation memory used by Telegram Chief AI.';
comment on table public.ai_temporary_agents is 'Owner-requested temporary AI specialists, normally expiring after 24 hours.';
