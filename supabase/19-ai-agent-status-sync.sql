-- WAHH AIR AI Office
-- Fix agent status after owner approval/rejection/revision.
-- Run after migration 18.

create or replace function public.admin_ai_set_task_approval(
  p_task_id uuid,
  p_status text,
  p_feedback text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_agent uuid;
  v_agent_code text;
begin
  if not public.is_admin() then
    raise exception 'Admin sahaja';
  end if;

  if p_status not in ('approved','rejected','revision_requested') then
    raise exception 'Status approval tidak sah';
  end if;

  select t.assigned_agent_id, a.code
  into v_agent, v_agent_code
  from public.ai_tasks t
  left join public.ai_agents a on a.id = t.assigned_agent_id
  where t.id = p_task_id;

  if v_agent is null then
    raise exception 'Task tidak ditemui';
  end if;

  update public.ai_tasks
  set
    approval_status = p_status,
    status = case
      when p_status = 'revision_requested' then 'queued'
      else 'completed'
    end,
    completed_at = case
      when p_status in ('approved','rejected') then now()
      else null
    end
  where id = p_task_id;

  update public.ai_agents
  set
    status = case
      when p_status = 'revision_requested' then 'queued'
      else 'standby'
    end,
    updated_at = now()
  where id = v_agent;

  insert into public.ai_approvals(
    task_id,
    status,
    owner_feedback,
    decided_by,
    decided_at
  ) values (
    p_task_id,
    p_status,
    p_feedback,
    auth.uid(),
    now()
  );

  insert into public.ai_activity_logs(
    task_id,
    agent_id,
    actor_user_id,
    action,
    details
  ) values (
    p_task_id,
    v_agent,
    auth.uid(),
    'approval_' || p_status,
    jsonb_build_object(
      'feedback', p_feedback,
      'agent_code', v_agent_code,
      'agent_status', case
        when p_status = 'revision_requested' then 'queued'
        else 'standby'
      end
    )
  );
end;
$$;

revoke execute on function public.admin_ai_set_task_approval(uuid,text,text) from public;
grant execute on function public.admin_ai_set_task_approval(uuid,text,text) to authenticated;
