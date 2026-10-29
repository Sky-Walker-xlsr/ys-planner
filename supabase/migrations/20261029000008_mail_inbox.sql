-- ys-planner: Tasks per E-Mail – Eingang (Tasks ohne Planner), Mail-Tags, Absender-Adressen,
-- persönliche Tags. Setzt 20261029000007 voraus.

-- ---------------------------------------------------------------------------
-- Eingang: Tasks ohne Planner gehören ihrem Owner
-- ---------------------------------------------------------------------------
alter table public.tasks alter column planner_id drop not null;
alter table public.tasks alter column bucket_id drop not null;
alter table public.tasks add column owner_id uuid references public.users (id) on delete cascade;
-- Absender der Original-Mail (Meta)
alter table public.tasks add column mail_sender text;
alter table public.tasks add constraint tasks_planner_or_owner_check check (planner_id is not null or owner_id is not null);
alter table public.tasks add constraint tasks_bucket_iff_planner_check check ((planner_id is null) = (bucket_id is null));
create index tasks_inbox_idx on public.tasks (owner_id) where planner_id is null;

create or replace function app.tg_tasks_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  bucket_planner uuid;
begin
  if new.bucket_id is not null then
    select planner_id into bucket_planner from public.buckets where id = new.bucket_id;
  end if;
  if tg_op = 'INSERT' then
    if new.planner_id is null and new.bucket_id is not null then
      new.planner_id := bucket_planner;
    end if;
    -- Eingang: immer der eigene
    if new.planner_id is null and auth.uid() is not null and not app.is_guest() then
      new.owner_id := auth.uid();
    end if;
    if auth.uid() is not null then
      if app.is_guest() then
        new.created_by := null;
        new.created_by_guest := app.guest_name();
      else
        new.created_by := auth.uid();
        new.created_by_guest := null;
      end if;
    end if;
  elsif old.planner_id is not null and new.planner_id is distinct from old.planner_id then
    raise exception 'planner_id kann nicht geändert werden' using errcode = '42501';
  elsif new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id kann nicht geändert werden' using errcode = '42501';
  end if;

  if new.planner_id is not null and bucket_planner is distinct from new.planner_id then
    raise exception 'Bucket gehört nicht zum Planner' using errcode = '23514';
  end if;

  if new.status = 'done' and (tg_op = 'INSERT' or old.status <> 'done') then
    new.completed_at := now();
  elsif new.status <> 'done' then
    new.completed_at := null;
  end if;
  return new;
end
$$;

-- Aktivitätsprotokoll nur für Planner-Tasks
create or replace function app.tg_tasks_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor_name text := case when app.is_guest() then app.guest_name() else null end;
begin
  if tg_op = 'INSERT' then
    if new.planner_id is null then return null; end if;
    insert into public.activity_log (planner_id, task_id, actor, actor_name, action, payload)
    values (new.planner_id, new.id, auth.uid(), actor_name, 'task_created', jsonb_build_object('title', new.title));
  elsif tg_op = 'UPDATE' then
    if new.planner_id is null then return null; end if;
    if old.planner_id is null then
      insert into public.activity_log (planner_id, task_id, actor, actor_name, action, payload)
      values (new.planner_id, new.id, auth.uid(), actor_name, 'task_created', jsonb_build_object('title', new.title, 'from', 'inbox'));
      return null;
    end if;
    if new.status is distinct from old.status then
      insert into public.activity_log (planner_id, task_id, actor, actor_name, action, payload)
      values (new.planner_id, new.id, auth.uid(), actor_name, 'task_status',
              jsonb_build_object('from', old.status, 'to', new.status));
    end if;
    if new.bucket_id is distinct from old.bucket_id then
      insert into public.activity_log (planner_id, task_id, actor, actor_name, action, payload)
      values (new.planner_id, new.id, auth.uid(), actor_name, 'task_moved',
              jsonb_build_object('from', old.bucket_id, 'to', new.bucket_id));
    end if;
  elsif tg_op = 'DELETE' then
    if old.planner_id is not null and exists (select 1 from public.planners where id = old.planner_id) then
      insert into public.activity_log (planner_id, task_id, actor, actor_name, action, payload)
      values (old.planner_id, null, auth.uid(), actor_name, 'task_deleted', jsonb_build_object('title', old.title));
    end if;
  end if;
  return null;
end
$$;

-- Eigener Inbox-Task?
create or replace function app.owns_inbox_task(t uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.tasks
     where id = t and planner_id is null and owner_id = app.uid()
  )
$$;

create policy tasks_inbox_select on public.tasks for select to authenticated
  using (planner_id is null and owner_id = (select app.uid()));
create policy tasks_inbox_insert on public.tasks for insert to authenticated
  with check (planner_id is null and owner_id = (select app.uid()));
-- Verschieben in einen Planner: USING greift hier, WITH CHECK über tasks_update (Rolle ≥ editor im Ziel)
create policy tasks_inbox_update on public.tasks for update to authenticated
  using (planner_id is null and owner_id = (select app.uid()))
  with check (planner_id is null and owner_id = (select app.uid()));
create policy tasks_inbox_delete on public.tasks for delete to authenticated
  using (planner_id is null and owner_id = (select app.uid()));

-- ---------------------------------------------------------------------------
-- Task-Dateien im Eingang: inbox/{user_id}/{task_id}/{file_id}-{dateiname}
-- ---------------------------------------------------------------------------
alter table public.task_files alter column planner_id drop not null;
alter table public.task_files drop constraint if exists task_files_storage_path_check;
alter table public.task_files add constraint task_files_storage_path_check check (
  (planner_id is not null and storage_path = 'tasks/' || task_id::text || '/' || id::text || '-' || name)
  or (planner_id is null and storage_path ~ '^inbox/[0-9a-f-]{36}/'
      and right(storage_path, length(task_id::text || '/' || id::text || '-' || name) + 1)
          = '/' || task_id::text || '/' || id::text || '-' || name)
);

create or replace function app.tg_task_files_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  task_planner uuid;
  task_owner uuid;
begin
  select planner_id, owner_id into task_planner, task_owner from public.tasks where id = new.task_id;
  if not found then
    raise exception 'Task nicht gefunden' using errcode = '23503';
  end if;
  new.planner_id := task_planner;
  new.storage_path := case
    when task_planner is null then 'inbox/' || task_owner::text || '/' || new.task_id::text || '/' || new.id::text || '-' || new.name
    else 'tasks/' || new.task_id::text || '/' || new.id::text || '-' || new.name
  end;
  if auth.uid() is not null then
    if app.is_guest() then
      new.uploaded_by := null;
      new.uploaded_by_guest := app.guest_name();
    else
      new.uploaded_by := auth.uid();
      new.uploaded_by_guest := null;
    end if;
  end if;
  return new;
end
$$;

create policy task_files_inbox_select on public.task_files for select to authenticated
  using (planner_id is null and app.owns_inbox_task(task_id));
create policy task_files_inbox_insert on public.task_files for insert to authenticated
  with check (planner_id is null and app.owns_inbox_task(task_id));
create policy task_files_inbox_delete on public.task_files for delete to authenticated
  using (planner_id is null and app.owns_inbox_task(task_id));

-- ---------------------------------------------------------------------------
-- Persönliche Tags an Inbox-Tasks (werden beim Verschieben zu Labels)
-- ---------------------------------------------------------------------------
create table public.user_tags (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null check (length(name) between 1 and 60 and name !~ '\s'),
  created_at timestamptz not null default now(),
  primary key (task_id, name)
);
create index user_tags_user_idx on public.user_tags (user_id);

alter table public.user_tags enable row level security;
revoke all on public.user_tags from anon, authenticated;
grant select, insert, delete on public.user_tags to authenticated;
create policy user_tags_select on public.user_tags for select to authenticated
  using (user_id = (select app.uid()));
create policy user_tags_insert on public.user_tags for insert to authenticated
  with check (user_id = (select app.uid()) and app.owns_inbox_task(task_id));
create policy user_tags_delete on public.user_tags for delete to authenticated
  using (user_id = (select app.uid()));

-- Nächste freie Label-Farbe im Planner (danach reihum)
create or replace function app.next_label_color(p uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select c from unnest(array['blue', 'violet', 'orange', 'pink', 'teal', 'yellow']) with ordinality as x(c, i)
      where not exists (select 1 from public.labels l where l.planner_id = p and l.color = x.c)
      order by i limit 1),
    (array['blue', 'violet', 'orange', 'pink', 'teal', 'yellow'])[
      (select count(*) from public.labels l where l.planner_id = p) % 6 + 1]
  )
$$;

-- Labels per Name sicherstellen (fehlende mit der nächsten freien Farbe) und an den Task hängen
create or replace function app.attach_labels(t uuid, p uuid, names text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  n text;
  label uuid;
begin
  foreach n in array coalesce(names, '{}') loop
    n := left(trim(n), 60);
    continue when n = '';
    select id into label from public.labels where planner_id = p and lower(name) = lower(n) limit 1;
    if label is null then
      insert into public.labels (planner_id, name, color) values (p, n, app.next_label_color(p)) returning id into label;
    end if;
    insert into public.task_labels (task_id, label_id, planner_id) values (t, label, p) on conflict do nothing;
  end loop;
end
$$;

-- Verschieben Eingang → Planner: Tags werden Labels, Dateien bekommen den tasks/-Pfad
-- (die Objekte in R2 verschiebt der Route Handler)
create or replace function app.tg_tasks_after_move() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.planner_id is null and new.planner_id is not null then
    perform app.attach_labels(new.id, new.planner_id,
      array(select name from public.user_tags where task_id = new.id order by created_at));
    delete from public.user_tags where task_id = new.id;
    update public.task_files
       set planner_id = new.planner_id,
           storage_path = 'tasks/' || task_id::text || '/' || id::text || '-' || name
     where task_id = new.id;
  end if;
  return null;
end
$$;

create trigger tasks_after_move after update of planner_id on public.tasks
  for each row execute function app.tg_tasks_after_move();

-- ---------------------------------------------------------------------------
-- Mail-Adresse pro User, Absender-Adressen, Mail-Tag pro Planner
-- ---------------------------------------------------------------------------
-- Zufällige Adresse {inbox_local}@salm.li; Neu-Generieren macht die alte sofort ungültig
alter table public.user_settings add column inbox_local text
  default lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10))
  check (inbox_local ~ '^[a-z0-9]{8,32}$');
alter table public.user_settings add constraint user_settings_inbox_local_key unique (inbox_local);

create table public.user_sender_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  email text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  token_hash text,
  token_expires_at timestamptz,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, email)
);
-- Eine bestätigte Adresse gehört genau einem User
create unique index user_sender_emails_confirmed_uq on public.user_sender_emails (email) where confirmed_at is not null;

alter table public.user_sender_emails enable row level security;
-- Anlegen und Bestätigen nur serverseitig (Token)
revoke all on public.user_sender_emails from anon, authenticated;
grant select (id, user_id, email, confirmed_at, created_at), delete on public.user_sender_emails to authenticated;
create policy user_sender_emails_select on public.user_sender_emails for select to authenticated
  using (user_id = (select app.uid()));
create policy user_sender_emails_delete on public.user_sender_emails for delete to authenticated
  using (user_id = (select app.uid()));

alter table public.planners add column mail_tag text
  check (mail_tag ~ '^[a-z0-9-]{1,40}$' and mail_tag not in ('dringend', 'wichtig', 'mittel', 'niedrig'));
create unique index planners_owner_mail_tag_uq on public.planners (owner_id, mail_tag) where mail_tag is not null;

-- Für den Mail-Eingang (Service-Role): Planner mit passendem Tag und effektiver Rolle des Users
create or replace function public.mail_planner_candidates(u uuid, tags text[])
returns table (planner_id uuid, name text, mail_tag text, owner_id uuid, role public.member_role)
language sql stable security definer set search_path = '' as $$
  select p.id, p.name, p.mail_tag, p.owner_id, app.planner_role_of(p.id, u)
    from public.planners p
   where p.mail_tag = any (tags)
     and app.planner_role_of(p.id, u) is not null
$$;
revoke execute on function public.mail_planner_candidates(uuid, text[]) from public, anon, authenticated;
grant execute on function public.mail_planner_candidates(uuid, text[]) to service_role;

create or replace function public.mail_attach_labels(t uuid, p uuid, names text[]) returns void
language sql security definer set search_path = '' as $$
  select app.attach_labels(t, p, names)
$$;
revoke execute on function public.mail_attach_labels(uuid, uuid, text[]) from public, anon, authenticated;
grant execute on function public.mail_attach_labels(uuid, uuid, text[]) to service_role;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;

alter publication supabase_realtime add table public.user_tags;
