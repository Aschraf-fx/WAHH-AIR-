-- WAHH AIR AI Office / AI Staff foundation
-- Run after the existing WAHH AIR migrations.
-- V1 staff: CHIEF, MARKETING, ACCOUNTING only.

create table if not exists public.ai_agents (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('chief','marketing','accounting')),
  display_name text not null,
  description text,
  status text not null default 'standby' check (status in ('standby','queued','working','waiting_approval','failed')),
  enabled boolean not null default true,
  provider text not null default 'rootsys',
  model_name text,
  monthly_budget numeric(12,4),
  max_delegation_depth integer not null default 2 check (max_delegation_depth between 0 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.ai_agents(code,display_name,description)
values
  ('chief','Chief AI','Manager AI yang memahami arahan owner, route task dan merumuskan hasil.'),
  ('marketing','Marketing AI','Menghasilkan strategi, copywriting dan output marketing menggunakan data WAHH AIR yang diluluskan.'),
  ('accounting','Accounting AI','Menganalisis data kewangan menggunakan pengiraan backend yang deterministic dan akses read-only.')
on conflict (code) do update set display_name=excluded.display_name,description=excluded.description;

create table if not exists public.ai_projects (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'active' check (status in ('active','completed','cancelled')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.ai_tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references public.ai_projects(id) on delete set null,
  parent_task_id uuid references public.ai_tasks(id) on delete set null,
  created_by uuid references auth.users(id),
  assigned_agent_id uuid references public.ai_agents(id),
  original_instruction text not null,
  task_description text,
  status text not null default 'queued' check (status in ('standby','queued','working','waiting_approval','completed','failed','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  approval_required boolean not null default false,
  approval_status text not null default 'pending' check (approval_status in ('pending','approved','rejected','revision_requested','not_required')),
  result_summary text,
  result_json jsonb,
  error_message text,
  delegation_depth integer not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz
);
create index if not exists ai_tasks_status_idx on public.ai_tasks(status,created_at desc);
create index if not exists ai_tasks_agent_idx on public.ai_tasks(assigned_agent_id,created_at desc);
create index if not exists ai_tasks_project_idx on public.ai_tasks(project_id,created_at desc);

create table if not exists public.ai_outputs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks(id) on delete cascade,
  output_type text not null default 'text',
  title text,
  content_text text,
  content_json jsonb,
  storage_path text,
  version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_approvals (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.ai_tasks(id) on delete cascade,
  output_id uuid references public.ai_outputs(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','rejected','revision_requested')),
  owner_feedback text,
  decided_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create table if not exists public.ai_usage (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.ai_tasks(id) on delete set null,
  agent_id uuid references public.ai_agents(id) on delete set null,
  provider text not null,
  model text,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  estimated_cost numeric(14,6) not null default 0,
  cost_currency text not null default 'CNY',
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_created_idx on public.ai_usage(created_at desc);

create table if not exists public.ai_activity_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references public.ai_tasks(id) on delete set null,
  agent_id uuid references public.ai_agents(id) on delete set null,
  actor_user_id uuid references auth.users(id),
  action text not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.business_knowledge (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  content text not null,
  source_type text,
  source_id text,
  approved boolean not null default false,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists business_knowledge_lookup_idx on public.business_knowledge(category,approved,updated_at desc);

create table if not exists public.brand_assets (
  id uuid primary key default gen_random_uuid(),
  asset_type text not null,
  name text not null,
  storage_path text not null,
  metadata jsonb,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.ai_agents enable row level security;
alter table public.ai_projects enable row level security;
alter table public.ai_tasks enable row level security;
alter table public.ai_outputs enable row level security;
alter table public.ai_approvals enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_activity_logs enable row level security;
alter table public.business_knowledge enable row level security;
alter table public.brand_assets enable row level security;

-- No anon access. Authenticated admins only.
revoke all on public.ai_agents,public.ai_projects,public.ai_tasks,public.ai_outputs,public.ai_approvals,public.ai_usage,public.ai_activity_logs,public.business_knowledge,public.brand_assets from anon;
revoke all on public.ai_agents,public.ai_projects,public.ai_tasks,public.ai_outputs,public.ai_approvals,public.ai_usage,public.ai_activity_logs,public.business_knowledge,public.brand_assets from authenticated;

do $$
begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ai_agents' and policyname='admin ai_agents') then
    create policy "admin ai_agents" on public.ai_agents for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ai_projects' and policyname='admin ai_projects') then
    create policy "admin ai_projects" on public.ai_projects for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ai_tasks' and policyname='admin ai_tasks') then
    create policy "admin ai_tasks" on public.ai_tasks for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ai_outputs' and policyname='admin ai_outputs') then
    create policy "admin ai_outputs" on public.ai_outputs for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ai_approvals' and policyname='admin ai_approvals') then
    create policy "admin ai_approvals" on public.ai_approvals for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ai_usage' and policyname='admin ai_usage') then
    create policy "admin ai_usage" on public.ai_usage for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='ai_activity_logs' and policyname='admin ai_activity_logs') then
    create policy "admin ai_activity_logs" on public.ai_activity_logs for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='business_knowledge' and policyname='admin business_knowledge') then
    create policy "admin business_knowledge" on public.business_knowledge for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='brand_assets' and policyname='admin brand_assets') then
    create policy "admin brand_assets" on public.brand_assets for all to authenticated using (public.is_admin()) with check (public.is_admin());
  end if;
end$$;

create or replace function public.admin_ai_office_overview()
returns jsonb language sql stable security definer set search_path='' as $$
  select case when public.is_admin() then jsonb_build_object(
    'agents',coalesce((select jsonb_agg(to_jsonb(a) order by case a.code when 'chief' then 1 when 'marketing' then 2 else 3 end) from public.ai_agents a),'[]'::jsonb),
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
  if p_code not in ('chief','marketing','accounting') then raise exception 'Agent tidak sah'; end if;
  update public.ai_agents set model_name=nullif(trim(p_model_name),''),monthly_budget=p_monthly_budget,updated_at=now() where code=p_code;
  insert into public.ai_activity_logs(actor_user_id,action,details) values(auth.uid(),'agent_config_updated',jsonb_build_object('agent',p_code,'model_name',nullif(trim(p_model_name),''),'monthly_budget',p_monthly_budget));
end;$$;

create or replace function public.admin_ai_set_task_approval(p_task_id uuid,p_status text,p_feedback text default null)
returns void language plpgsql security definer set search_path='' as $$
declare v_agent uuid;
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  if p_status not in ('approved','rejected','revision_requested') then raise exception 'Status approval tidak sah'; end if;
  select assigned_agent_id into v_agent from public.ai_tasks where id=p_task_id;
  if v_agent is null then raise exception 'Task tidak ditemui'; end if;
  update public.ai_tasks set approval_status=p_status,status=case when p_status='approved' then 'completed' when p_status='revision_requested' then 'queued' else 'completed' end,completed_at=case when p_status in ('approved','rejected') then now() else null end where id=p_task_id;
  insert into public.ai_approvals(task_id,status,owner_feedback,decided_by,decided_at) values(p_task_id,p_status,p_feedback,auth.uid(),now());
  insert into public.ai_activity_logs(task_id,agent_id,actor_user_id,action,details) values(p_task_id,v_agent,auth.uid(),'approval_'||p_status,jsonb_build_object('feedback',p_feedback));
end;$$;

create or replace function public.admin_ai_cancel_task(p_task_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not public.is_admin() then raise exception 'Admin sahaja'; end if;
  update public.ai_tasks set status='cancelled',cancelled_at=now(),completed_at=now() where id=p_task_id and status in ('queued','standby');
  if not found then raise exception 'Task tidak boleh dibatalkan pada status semasa'; end if;
  insert into public.ai_activity_logs(task_id,actor_user_id,action) values(p_task_id,auth.uid(),'task_cancelled');
end;$$;

revoke execute on function public.admin_ai_office_overview() from public;
revoke execute on function public.admin_ai_update_agent(text,text,numeric) from public;
revoke execute on function public.admin_ai_set_task_approval(uuid,text,text) from public;
revoke execute on function public.admin_ai_cancel_task(uuid) from public;
grant execute on function public.admin_ai_office_overview() to authenticated;
grant execute on function public.admin_ai_update_agent(text,text,numeric) to authenticated;
grant execute on function public.admin_ai_set_task_approval(uuid,text,text) to authenticated;
grant execute on function public.admin_ai_cancel_task(uuid) to authenticated;
