-- ys-planner: Helper-Funktionen und Trigger

-- ---------------------------------------------------------------------------
-- JWT-Helfer
-- Gäste erhalten ein JWT mit Claim share_link_id; ihre sub ist eine zufällige
-- UUID, die NICHT in public.users existiert.
-- ---------------------------------------------------------------------------
create or replace function app.is_guest() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(auth.jwt() ? 'share_link_id', false)
$$;

-- ID des eingeloggten Users (null für Gäste und Service-Role)
create or replace function app.uid() returns uuid
language sql stable set search_path = '' as $$
  select case when app.is_guest() then null else auth.uid() end
$$;

create or replace function app.guest_name() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(trim(auth.jwt() ->> 'guest_name'), ''), 'Gast')
$$;

create or replace function app.role_rank(r public.member_role) returns int
language sql immutable set search_path = '' as $$
  select case r when 'owner' then 3 when 'editor' then 2 when 'viewer' then 1 else 0 end
$$;

-- Rolle eines Gasts im Planner p (null, wenn Link ungültig/widerrufen/abgelaufen)
create or replace function app.guest_role(p uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select case when l.permission = 'edit' then 'editor'::public.member_role
              else 'viewer'::public.member_role end
  from public.share_links l
  where app.is_guest()
    and l.id = (auth.jwt() ->> 'share_link_id')::uuid
    and l.planner_id = p
    and (auth.jwt() ->> 'planner_id')::uuid = p
    and l.revoked_at is null
    and (l.expires_at is null or l.expires_at > now())
$$;

-- Effektive Rolle eines Users u im Planner p:
-- höchste Rolle aus planner_members und folder_members des Ordners.
create or replace function app.planner_role_of(p uuid, u uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select r from (
    select pm.role as r
      from public.planner_members pm
     where pm.planner_id = p and pm.user_id = u
    union all
    select fm.role
      from public.planners pl
      join public.folder_members fm on fm.folder_id = pl.folder_id and fm.user_id = u
     where pl.id = p
  ) x
  order by app.role_rank(r) desc
  limit 1
$$;

-- Effektive Rolle des aktuellen Requests (User oder Gast) im Planner p.
create or replace function public.planner_role(p uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select case when app.is_guest() then app.guest_role(p)
              else app.planner_role_of(p, auth.uid()) end
$$;

create or replace function app.has_role(p uuid, min_role public.member_role) returns boolean
language sql stable set search_path = '' as $$
  select app.role_rank(public.planner_role(p)) >= app.role_rank(min_role)
$$;

-- Rolle des aktuellen Users im Ordner f (Gäste: immer null)
create or replace function public.folder_role(f uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select fm.role
    from public.folder_members fm
   where fm.folder_id = f and fm.user_id = app.uid()
$$;

-- Ordner sichtbar: Mitglied des Ordners oder Zugriff auf mindestens einen Planner darin
create or replace function app.can_see_folder(f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not app.is_guest() and (
    public.folder_role(f) is not null
      or exists (
        select 1 from public.planners pl
         where pl.folder_id = f and public.planner_role(pl.id) is not null
      ))
$$;

create or replace function app.guest_sees_folder(f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_guest() and exists (
    select 1 from public.planners pl
     where pl.folder_id = f
       and pl.id = (auth.jwt() ->> 'planner_id')::uuid
       and app.guest_role(pl.id) is not null
  )
$$;

-- Gäste sehen nur User, die Mitglied ihres Planners (direkt oder via Ordner) sind
create or replace function app.guest_can_see_user(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.planner_role_of((auth.jwt() ->> 'planner_id')::uuid, u) is not null
     and app.guest_role((auth.jwt() ->> 'planner_id')::uuid) is not null
$$;

-- Für Storage-Policies: Text sicher in UUID umwandeln
create or replace function app.try_uuid(t text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  return t::uuid;
exception when others then
  return null;
end
$$;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
revoke execute on function public.planner_role(uuid) from public, anon;
revoke execute on function public.folder_role(uuid) from public, anon;
grant execute on function public.planner_role(uuid) to authenticated, service_role;
grant execute on function public.folder_role(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generische Trigger
-- ---------------------------------------------------------------------------
create or replace function app.tg_set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end
$$;

-- Setzt position = max(position im Scope) + 1024, wenn nicht angegeben.
-- TG_ARGV[0] = Scope-Spalte (uuid)
create or replace function app.tg_set_position() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  scope_col text := tg_argv[0];
  scope_val uuid := (to_jsonb(new) ->> scope_col)::uuid;
  max_pos double precision;
begin
  if new.position is null then
    execute format('select max(position) from %I.%I where %I = $1',
                   tg_table_schema, tg_table_name, scope_col)
      into max_pos using scope_val;
    new.position := coalesce(max_pos, 0) + 1024;
  end if;
  return new;
end
$$;

-- ---------------------------------------------------------------------------
-- Users
-- ---------------------------------------------------------------------------
create or replace function app.tg_users_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.user_settings (user_id, notify_email)
  values (new.id, new.email)
  on conflict (user_id) do nothing;
  return new;
end
$$;

create trigger users_updated_at before update on public.users
  for each row execute function app.tg_set_updated_at();
create trigger users_after_insert after insert on public.users
  for each row execute function app.tg_users_after_insert();
create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function app.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Ordner
-- ---------------------------------------------------------------------------
create or replace function app.tg_folders_before() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.owner_id := app.uid();
    end if;
  elsif new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id kann nicht geändert werden' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function app.tg_folders_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.folder_members (folder_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (folder_id, user_id) do update set role = 'owner';
  return new;
end
$$;

create trigger folders_before before insert or update on public.folders
  for each row execute function app.tg_folders_before();
create trigger folders_position before insert on public.folders
  for each row execute function app.tg_set_position('owner_id');
create trigger folders_updated_at before update on public.folders
  for each row execute function app.tg_set_updated_at();
create trigger folders_after_insert after insert on public.folders
  for each row execute function app.tg_folders_after_insert();

-- Der Ersteller bleibt fix Owner des Ordners
create or replace function app.tg_folder_members_protect_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  creator uuid;
begin
  select owner_id into creator from public.folders where id = old.folder_id;
  if creator is not null and creator = old.user_id
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.user_id <> old.user_id) then
    raise exception 'Der Ersteller des Ordners bleibt Owner' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;

create trigger folder_members_protect_owner before update or delete on public.folder_members
  for each row execute function app.tg_folder_members_protect_owner();

-- ---------------------------------------------------------------------------
-- Planner
-- ---------------------------------------------------------------------------
create or replace function app.tg_planners_before() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.owner_id := app.uid();
    end if;
  elsif new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id kann nicht geändert werden' using errcode = '42501';
  end if;

  -- In einen Ordner verschieben/anlegen: nur als Owner des Zielordners
  if new.folder_id is not null
     and (tg_op = 'INSERT' or new.folder_id is distinct from old.folder_id)
     and auth.uid() is not null
     and public.folder_role(new.folder_id) is distinct from 'owner' then
    raise exception 'Nur Owner des Zielordners dürfen Planner hineinverschieben' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace function app.tg_planners_after_insert() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.planner_members (planner_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict (planner_id, user_id) do update set role = 'owner';
  return new;
end
$$;

create trigger planners_before before insert or update on public.planners
  for each row execute function app.tg_planners_before();
create trigger planners_position before insert on public.planners
  for each row execute function app.tg_set_position('owner_id');
create trigger planners_updated_at before update on public.planners
  for each row execute function app.tg_set_updated_at();
create trigger planners_after_insert after insert on public.planners
  for each row execute function app.tg_planners_after_insert();

create or replace function app.tg_planner_members_protect_owner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  creator uuid;
begin
  select owner_id into creator from public.planners where id = old.planner_id;
  if creator is not null and creator = old.user_id
     and (tg_op = 'DELETE' or new.role <> 'owner' or new.user_id <> old.user_id) then
    raise exception 'Der Ersteller des Planners bleibt Owner' using errcode = '42501';
  end if;
  return coalesce(new, old);
end
$$;

create trigger planner_members_protect_owner before update or delete on public.planner_members
  for each row execute function app.tg_planner_members_protect_owner();

create trigger favorites_position before insert on public.favorites
  for each row execute function app.tg_set_position('user_id');

-- ---------------------------------------------------------------------------
-- Buckets / Labels
-- ---------------------------------------------------------------------------
create or replace function app.tg_immutable_planner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.planner_id is distinct from old.planner_id then
    raise exception 'planner_id kann nicht geändert werden' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger buckets_position before insert on public.buckets
  for each row execute function app.tg_set_position('planner_id');
create trigger buckets_updated_at before update on public.buckets
  for each row execute function app.tg_set_updated_at();
create trigger buckets_immutable before update on public.buckets
  for each row execute function app.tg_immutable_planner();
create trigger labels_immutable before update on public.labels
  for each row execute function app.tg_immutable_planner();

-- ---------------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------------
create or replace function app.tg_tasks_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  bucket_planner uuid;
begin
  select planner_id into bucket_planner from public.buckets where id = new.bucket_id;
  if tg_op = 'INSERT' then
    new.planner_id := coalesce(new.planner_id, bucket_planner);
    if auth.uid() is not null then
      if app.is_guest() then
        new.created_by := null;
        new.created_by_guest := app.guest_name();
      else
        new.created_by := auth.uid();
        new.created_by_guest := null;
      end if;
    end if;
  elsif new.planner_id is distinct from old.planner_id then
    raise exception 'planner_id kann nicht geändert werden' using errcode = '42501';
  end if;

  if bucket_planner is distinct from new.planner_id then
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

create trigger tasks_before before insert or update on public.tasks
  for each row execute function app.tg_tasks_before();
create trigger tasks_position before insert on public.tasks
  for each row execute function app.tg_set_position('bucket_id');
create trigger tasks_updated_at before update on public.tasks
  for each row execute function app.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Kind-Tabellen von Tasks: planner_id aus dem Task ableiten
-- ---------------------------------------------------------------------------
create or replace function app.tg_child_of_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  task_planner uuid;
begin
  select planner_id into task_planner from public.tasks where id = new.task_id;
  if task_planner is null then
    raise exception 'Task nicht gefunden' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.planner_id is distinct from old.planner_id then
    raise exception 'planner_id kann nicht geändert werden' using errcode = '42501';
  end if;
  new.planner_id := task_planner;

  if tg_table_name = 'task_labels' then
    if not exists (select 1 from public.labels l where l.id = new.label_id and l.planner_id = task_planner) then
      raise exception 'Label gehört nicht zum Planner' using errcode = '23514';
    end if;
  elsif tg_table_name = 'task_assignees' then
    if app.planner_role_of(task_planner, new.user_id) is null then
      raise exception 'User ist kein Mitglied des Planners' using errcode = '23514';
    end if;
  elsif tg_table_name = 'task_attachments' then
    if not exists (select 1 from public.kb_files f where f.id = new.kb_file_id and f.planner_id = task_planner) then
      raise exception 'Datei gehört nicht zum Planner' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger task_assignees_child before insert or update on public.task_assignees
  for each row execute function app.tg_child_of_task();
create trigger task_labels_child before insert or update on public.task_labels
  for each row execute function app.tg_child_of_task();
create trigger task_attachments_child before insert or update on public.task_attachments
  for each row execute function app.tg_child_of_task();
create trigger task_sections_child before insert or update on public.task_sections
  for each row execute function app.tg_child_of_task();
create trigger task_sections_position before insert on public.task_sections
  for each row execute function app.tg_set_position('task_id');
create trigger task_sections_updated_at before update on public.task_sections
  for each row execute function app.tg_set_updated_at();

create or replace function app.tg_section_items_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  section_planner uuid;
begin
  select planner_id into section_planner from public.task_sections where id = new.section_id;
  if section_planner is null then
    raise exception 'Abschnitt nicht gefunden' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.planner_id is distinct from old.planner_id then
    raise exception 'planner_id kann nicht geändert werden' using errcode = '42501';
  end if;
  new.planner_id := section_planner;
  return new;
end
$$;

create trigger section_items_before before insert or update on public.section_items
  for each row execute function app.tg_section_items_before();
create trigger section_items_position before insert on public.section_items
  for each row execute function app.tg_set_position('section_id');
create trigger section_items_updated_at before update on public.section_items
  for each row execute function app.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Kommentare: Autor aus dem JWT setzen
-- ---------------------------------------------------------------------------
create or replace function app.tg_comments_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  task_planner uuid;
begin
  if tg_op = 'INSERT' then
    select planner_id into task_planner from public.tasks where id = new.task_id;
    if task_planner is null then
      raise exception 'Task nicht gefunden' using errcode = '23503';
    end if;
    new.planner_id := task_planner;
    if auth.uid() is not null then
      if app.is_guest() then
        new.author_user_id := null;
        new.guest_id := auth.uid();
        new.guest_name := app.guest_name();
      else
        new.author_user_id := auth.uid();
        new.guest_id := null;
        new.guest_name := null;
      end if;
    end if;
  else
    if new.task_id is distinct from old.task_id or new.planner_id is distinct from old.planner_id
       or new.author_user_id is distinct from old.author_user_id or new.guest_id is distinct from old.guest_id then
      raise exception 'Kommentar-Zuordnung kann nicht geändert werden' using errcode = '42501';
    end if;
  end if;
  -- Erwähnungen auf Mitglieder des Planners beschränken
  new.mentions := coalesce(array(
    select distinct m from unnest(new.mentions) m
     where app.planner_role_of(new.planner_id, m) is not null
  ), '{}');
  return new;
end
$$;

create trigger comments_before before insert or update on public.comments
  for each row execute function app.tg_comments_before();
create trigger comments_updated_at before update on public.comments
  for each row execute function app.tg_set_updated_at();

-- ---------------------------------------------------------------------------
-- Knowledge Base
-- ---------------------------------------------------------------------------
create or replace function app.tg_kb_files_before() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.planner_id is distinct from old.planner_id or new.id is distinct from old.id) then
    raise exception 'planner_id kann nicht geändert werden' using errcode = '42501';
  end if;
  new.storage_path := new.planner_id::text || '/' || new.id::text || '.md';
  if auth.uid() is not null then
    if app.is_guest() then
      new.updated_by := null;
      new.updated_by_guest := app.guest_name();
    else
      new.updated_by := auth.uid();
      new.updated_by_guest := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

create trigger kb_files_before before insert or update on public.kb_files
  for each row execute function app.tg_kb_files_before();

-- ---------------------------------------------------------------------------
-- Aktivitätsprotokoll (Tasks)
-- ---------------------------------------------------------------------------
create or replace function app.tg_tasks_activity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  actor_name text := case when app.is_guest() then app.guest_name() else null end;
begin
  if tg_op = 'INSERT' then
    insert into public.activity_log (planner_id, task_id, actor, actor_name, action, payload)
    values (new.planner_id, new.id, auth.uid(), actor_name, 'task_created', jsonb_build_object('title', new.title));
  elsif tg_op = 'UPDATE' then
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
    -- Bei kaskadierendem Löschen des Planners existiert der Planner nicht mehr
    if exists (select 1 from public.planners where id = old.planner_id) then
      insert into public.activity_log (planner_id, task_id, actor, actor_name, action, payload)
      values (old.planner_id, null, auth.uid(), actor_name, 'task_deleted', jsonb_build_object('title', old.title));
    end if;
  end if;
  return null;
end
$$;

create trigger tasks_activity after insert or update or delete on public.tasks
  for each row execute function app.tg_tasks_activity();

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
