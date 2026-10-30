-- ys-planner: Persönliche Erinnerung pro Task und User (Versand per Cron alle 5 Minuten)

create table public.task_reminders (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  remind_at timestamptz not null,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_reminders_user_idx on public.task_reminders (user_id);
create index task_reminders_due_idx on public.task_reminders (remind_at) where sent_at is null;

-- Neuer Zeitpunkt macht eine bereits versendete Erinnerung wieder scharf
create or replace function app.tg_task_reminder_rearm() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.remind_at is distinct from old.remind_at then
    new.sent_at := null;
  end if;
  return new;
end
$$;
create trigger task_reminders_rearm before update on public.task_reminders
  for each row execute function app.tg_task_reminder_rearm();

alter table public.task_reminders enable row level security;
revoke all on public.task_reminders from anon, authenticated;
grant select, delete on public.task_reminders to authenticated;
-- sent_at setzt nur der Server; task_id/user_id wegen Upsert (RLS prüft sie)
grant insert (task_id, user_id, remind_at), update (task_id, user_id, remind_at) on public.task_reminders to authenticated;

-- Die Unterabfrage läuft unter der RLS von tasks: Erinnerung nur an sichtbare Tasks
create policy task_reminders_select on public.task_reminders for select to authenticated
  using (user_id = (select app.uid()));
create policy task_reminders_insert on public.task_reminders for insert to authenticated
  with check (user_id = (select app.uid()) and exists (select 1 from public.tasks t where t.id = task_id));
create policy task_reminders_update on public.task_reminders for update to authenticated
  using (user_id = (select app.uid()))
  with check (user_id = (select app.uid()) and exists (select 1 from public.tasks t where t.id = task_id));
create policy task_reminders_delete on public.task_reminders for delete to authenticated
  using (user_id = (select app.uid()));

-- Markiert fällige Erinnerungen als versendet und liefert die, für die eine Mail rausgeht.
-- Keine Mail: Task erledigt, kein Zugriff mehr auf den Task, keine Benachrichtigungs-Adresse.
create or replace function public.claim_due_reminders(max_rows integer)
returns table (task_id uuid, user_id uuid, title text, planner_id uuid, planner_name text, due_date date, email text)
language sql security definer set search_path = '' as $$
  with due as (
    select r.task_id, r.user_id
      from public.task_reminders r
     where r.sent_at is null and r.remind_at <= now()
     order by r.remind_at
     limit max_rows
       for update skip locked
  ), claimed as (
    update public.task_reminders r set sent_at = now()
      from due
     where r.task_id = due.task_id and r.user_id = due.user_id
    returning r.task_id, r.user_id
  )
  select c.task_id, c.user_id, t.title, t.planner_id, p.name, t.due_date, s.notify_email
    from claimed c
    join public.tasks t on t.id = c.task_id
    join public.user_settings s on s.user_id = c.user_id
    left join public.planners p on p.id = t.planner_id
   where t.status <> 'done'
     and s.notify_email is not null
     and case when t.planner_id is null then t.owner_id = c.user_id
              else app.planner_role_of(t.planner_id, c.user_id) is not null end
$$;
revoke execute on function public.claim_due_reminders(integer) from public, anon, authenticated;
grant execute on function public.claim_due_reminders(integer) to service_role;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
