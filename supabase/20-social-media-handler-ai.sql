-- WAHH AIR AI Office
-- Add Social Media Handler as V1 staff #4.
-- Run after migrations 18 and 19.

-- Extend the allowed AI agent codes without rebuilding existing AI Office tables.
alter table public.ai_agents drop constraint if exists ai_agents_code_check;
alter table public.ai_agents
  add constraint ai_agents_code_check
  check (code in ('chief','marketing','accounting','social_media'));

insert into public.ai_agents(code,display_name,description,provider,max_delegation_depth)
values (
  'social_media',
  'Social Media Handler AI',
  'Mengurus draft, jadual dan persediaan posting sosial media menggunakan bahan yang diluluskan. Publication sebenar mesti melalui approval owner dan connector platform.',
  'rootsys',
  2
)
on conflict (code) do update set
  display_name=excluded.display_name,
  description=excluded.description,
  updated_at=now();

-- Social account metadata only. OAuth/access tokens MUST stay server-side/env or secure provider storage.
create table if not exists public.social_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('facebook','instagram','tiktok','telegram','other')),
  account_name text not null,
  external_account_id text,
  active boolean not null default true,
  metadata jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.social_posts (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.ai_tasks(id) on delete set null,
  account_id uuid references public.social_accounts(id) on delete set null,
  platform text not null check (platform in ('facebook','instagram','tiktok','telegram','other')),
  title text,
  caption text,
  status text not null default 'draft' check (status in ('draft','waiting_approval','scheduled','posted','failed','cancelled')),
  scheduled_at timestamptz,
  posted_at timestamptz,
  external_post_id text,
  external_post_url text,
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected','revision_requested','not_required')),
  error_message text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists social_posts_status_idx on public.social_posts(status,scheduled_at,created_at desc);

create table if not exists public.social_post_assets (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  asset_type text not null check (asset_type in ('image','video','document','other')),
  storage_path text not null,
  source_output_id uuid references public.ai_outputs(id) on delete set null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.social_publish_logs (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.social_posts(id) on delete cascade,
  action text not null,
  status text not null,
  provider_response jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

alter table public.social_accounts enable row level security;
alter table public.social_posts enable row level security;
alter table public.social_post_assets enable row level security;
alter table public.social_publish_logs enable row level security;

revoke all on public.social_accounts,public.social_posts,public.social_post_assets,public.social_publish_logs from anon;
revoke all on public.social_accounts,public.social_posts,public.social_post_assets,public.social_publish_logs from authenticated;

do $$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='social_accounts' and policyname='admin social_accounts') then
    create policy "admin social_accounts" on public.social_accounts for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='social_posts' and policyname='admin social_posts') then
    create policy "admin social_posts" on public.social_posts for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='social_post_assets' and policyname='admin social_post_assets') then
    create policy "admin social_post_assets" on public.social_post_assets for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='social_publish_logs' and policyname='admin social_publish_logs') then
    create policy "admin social_publish_logs" on public.social_publish_logs for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end$$;

-- Include the new agent in the dashboard in a stable display order.
create or replace function public.admin_ai_office_overview()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.is_admin() then jsonb_build_object(
    'agents',coalesce((select jsonb_agg(to_jsonb(a) order by case a.code when 'chief' then 1 when 'marketing' then 2 when 'accounting' then 3 when 'social_media' then 4 else 99 end) from public.ai_agents a),'[]'::jsonb),
    'queued',(select count(*) from public.ai_tasks where status='queued'),
    'working',(select count(*) from public.ai_tasks where status='working'),
    'waiting_approval',(select count(*) from public.ai_tasks where status='waiting_approval'),
    'completed_today',(select count(*) from public.ai_tasks where status='completed' and completed_at::date=current_date),
    'active_projects',(select count(*) from public.ai_projects where status='active'),
    'month_usage',coalesce((select jsonb_build_object('input_tokens',sum(input_tokens),'output_tokens',sum(output_tokens),'estimated_cost',sum(estimated_cost)) from public.ai_usage where created_at>=date_trunc('month',now())),jsonb_build_object('input_tokens',0,'output_tokens',0,'estimated_cost',0)),
    'recent_tasks',coalesce((select jsonb_agg(to_jsonb(x)) from (select t.id,t.original_instruction,t.task_description,t.status,t.priority,t.approval_status,t.result_summary,t.error_message,t.created_at,t.completed_at,a.code agent_code,a.display_name agent_name from public.ai_tasks t left join public.ai_agents a on a.id=t.assigned_agent_id order by t.created_at desc limit 30)x),'[]'::jsonb)
  ) else null end;
$$;

create or replace function public.admin_ai_update_agent(p_code text,p_model_name text,p_monthly_budget numeric default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_code not in ('chief','marketing','accounting','social_media') then raise exception 'Agent tidak sah'; end if;
  update public.ai_agents set model_name=nullif(trim(p_model_name),''),monthly_budget=p_monthly_budget,updated_at=now() where code=p_code;
  insert into public.ai_activity_logs(actor_user_id,action,details) values(auth.uid(),'agent_config_updated',jsonb_build_object('agent',p_code,'model_name',nullif(trim(p_model_name),''),'monthly_budget',p_monthly_budget));
end;$$;

revoke execute on function public.admin_ai_office_overview() from public;
revoke execute on function public.admin_ai_update_agent(text,text,numeric) from public;
grant execute on function public.admin_ai_office_overview() to authenticated;
grant execute on function public.admin_ai_update_agent(text,text,numeric) to authenticated;
