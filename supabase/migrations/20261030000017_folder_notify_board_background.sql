-- ys-planner: Eigene Benachrichtigungs-Mail pro Ordner (pro User, gilt auch für Unterordner)
-- und persönlicher Board-Hintergrund.

-- ---------------------------------------------------------------------------
-- Benachrichtigungs-Mail pro Ordner
-- ---------------------------------------------------------------------------
create or replace function app.address_allowed(u uuid, e text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.users where id = u and lower(email) = lower(e))
      or exists (select 1 from public.user_sender_emails
                  where user_id = u and email = lower(e) and confirmed_at is not null)
$$;

create table public.folder_notify_emails (
  user_id uuid not null references public.users (id) on delete cascade,
  folder_id uuid not null references public.folders (id) on delete cascade,
  notify_email text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, folder_id)
);
create index folder_notify_emails_folder_idx on public.folder_notify_emails (folder_id);

-- Wie bei user_settings: nur Login-Mail oder bestätigte Adresse, sonst wäre es ein Mail-Versender an Fremde
create or replace function app.tg_folder_notify_email() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.notify_email := lower(trim(new.notify_email));
  if not app.address_allowed(new.user_id, new.notify_email) then
    raise exception 'notify_email_not_confirmed' using errcode = '42501';
  end if;
  return new;
end
$$;
create trigger folder_notify_email_check before insert or update on public.folder_notify_emails
  for each row execute function app.tg_folder_notify_email();

alter table public.folder_notify_emails enable row level security;
revoke all on public.folder_notify_emails from anon, authenticated;
grant select, delete on public.folder_notify_emails to authenticated;
grant insert (user_id, folder_id, notify_email), update (user_id, folder_id, notify_email) on public.folder_notify_emails to authenticated;
create policy folder_notify_emails_select on public.folder_notify_emails for select to authenticated
  using (user_id = (select app.uid()));
create policy folder_notify_emails_insert on public.folder_notify_emails for insert to authenticated
  with check (user_id = (select app.uid()) and app.can_see_folder(folder_id));
create policy folder_notify_emails_update on public.folder_notify_emails for update to authenticated
  using (user_id = (select app.uid()))
  with check (user_id = (select app.uid()) and app.can_see_folder(folder_id));
create policy folder_notify_emails_delete on public.folder_notify_emails for delete to authenticated
  using (user_id = (select app.uid()));

-- Nächstgelegene Adresse vom Ordner des Planners aufwärts. Eine später entfernte Adresse zählt nicht mehr.
create or replace function app.folder_notify_email(u uuid, p uuid) returns text
language sql stable security definer set search_path = '' as $$
  with recursive chain (id, depth) as (
    select pl.folder_id, 0 from public.planners pl where pl.id = p and pl.folder_id is not null
    union all
    select fo.parent_id, chain.depth + 1
      from public.folders fo
      join chain on chain.id = fo.id
     where fo.parent_id is not null and chain.depth < 100
  )
  select o.notify_email
    from chain
    join public.folder_notify_emails o on o.folder_id = chain.id and o.user_id = u
   where app.address_allowed(u, o.notify_email)
   order by chain.depth
   limit 1
$$;

create or replace function public.notify_overrides(user_ids uuid[], p uuid)
returns table (user_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select id, app.folder_notify_email(id, p)
    from unnest(user_ids) id
   where app.folder_notify_email(id, p) is not null
$$;
revoke execute on function public.notify_overrides(uuid[], uuid) from public, anon, authenticated;
grant execute on function public.notify_overrides(uuid[], uuid) to service_role;

-- Erinnerungen: Adresse des Ordners vor Benachrichtigungs-Mail vor Login-Mail
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
  select c.id, c.title, c.planner_id, p.name, c.due_date, a.email
    from recipients r
    join claimed c on c.id = r.task_id
    join public.users u on u.id = r.user_id
    left join public.user_settings s on s.user_id = r.user_id
    left join public.planners p on p.id = c.planner_id
    cross join lateral (
      select coalesce(app.folder_notify_email(r.user_id, c.planner_id), nullif(s.notify_email, ''), nullif(u.email, '')) as email
    ) a
   where c.status <> 'done' and a.email is not null
$$;

-- ---------------------------------------------------------------------------
-- Board-Hintergrund. Das Bild liegt unter backgrounds/{user_id}.webp; der Schlüssel wird nur
-- aus der Session abgeleitet, board_bg_image_at dient als Merker und Cache-Buster.
-- ---------------------------------------------------------------------------
alter table public.user_settings add column board_bg_color text check (board_bg_color ~ '^#[0-9a-fA-F]{6}$');
alter table public.user_settings add column board_bg_image_at timestamptz;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
