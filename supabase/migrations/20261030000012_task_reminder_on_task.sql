-- ys-planner: Erinnerung gehört zum Task und geht an alle Zugewiesenen (Eingang: an den Besitzer)

alter table public.tasks add column remind_at timestamptz;
alter table public.tasks add column reminder_sent_at timestamptz;
create index tasks_reminder_due_idx on public.tasks (remind_at) where remind_at is not null and reminder_sent_at is null;

-- Läuft nach tasks_updated_at (Trigger feuern alphabetisch):
-- neuer Zeitpunkt macht die Erinnerung wieder scharf, reminder_sent_at setzt nur der Server,
-- und der Versand zählt nicht als Änderung am Task
create or replace function app.tg_tasks_reminder() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.remind_at is distinct from old.remind_at then
    new.reminder_sent_at := null;
  elsif auth.uid() is not null then
    new.reminder_sent_at := old.reminder_sent_at;
  elsif new.reminder_sent_at is distinct from old.reminder_sent_at then
    new.updated_at := old.updated_at;
  end if;
  return new;
end
$$;
create trigger tasks_zz_reminder before update on public.tasks
  for each row execute function app.tg_tasks_reminder();

-- Markiert fällige Erinnerungen als versendet und liefert pro Empfänger eine Zeile.
-- Keine Mail: Task erledigt, niemand zugewiesen, Zugewiesene ohne Zugriff.
-- Adresse: Benachrichtigungs-Mail, sonst Login-Mail.
create or replace function public.claim_due_task_reminders(max_rows integer)
returns table (task_id uuid, title text, planner_id uuid, planner_name text, due_date date, email text)
language sql security definer set search_path = '' as $$
  with due as (
    select t.id
      from public.tasks t
     where t.remind_at <= now() and t.reminder_sent_at is null
     order by t.remind_at
     limit max_rows
       for update skip locked
  ), claimed as (
    update public.tasks t set reminder_sent_at = now()
      from due
     where t.id = due.id
    returning t.id, t.title, t.planner_id, t.owner_id, t.due_date, t.status
  ), recipients as (
    select c.id as task_id, a.user_id
      from claimed c
      join public.task_assignees a on a.task_id = c.id
     where c.planner_id is not null and app.planner_role_of(c.planner_id, a.user_id) is not null
    union
    select c.id, c.owner_id
      from claimed c
     where c.planner_id is null
  )
  select c.id, c.title, c.planner_id, p.name, c.due_date,
         coalesce(nullif(s.notify_email, ''), nullif(u.email, ''))
    from recipients r
    join claimed c on c.id = r.task_id
    join public.users u on u.id = r.user_id
    left join public.user_settings s on s.user_id = r.user_id
    left join public.planners p on p.id = c.planner_id
   where c.status <> 'done'
     and coalesce(nullif(s.notify_email, ''), nullif(u.email, '')) is not null
$$;
revoke execute on function public.claim_due_task_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_task_reminders(integer) to service_role;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
