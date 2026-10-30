-- ys-planner: Task in einen anderen Planner verschieben (Rolle ≥ editor in beiden).
-- planner_id bleibt sonst unveränderlich; nur public.move_task setzt den Marker app.task_move
-- (lokal in der Transaktion, über die API nicht setzbar).

create or replace function app.task_moving() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(current_setting('app.task_move', true), '') = 'on'
$$;

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
  elsif old.planner_id is not null and new.planner_id is distinct from old.planner_id and not app.task_moving() then
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

create or replace function app.tg_child_of_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  task_planner uuid;
begin
  select planner_id into task_planner from public.tasks where id = new.task_id;
  if task_planner is null then
    raise exception 'Task nicht gefunden' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.planner_id is distinct from old.planner_id and not app.task_moving() then
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

create or replace function app.tg_section_items_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  section_planner uuid;
begin
  select planner_id into section_planner from public.task_sections where id = new.section_id;
  if section_planner is null then
    raise exception 'Abschnitt nicht gefunden' using errcode = '23503';
  end if;
  if tg_op = 'UPDATE' and new.planner_id is distinct from old.planner_id and not app.task_moving() then
    raise exception 'planner_id kann nicht geändert werden' using errcode = '42501';
  end if;
  new.planner_id := section_planner;
  return new;
end
$$;

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
    if new.task_id is distinct from old.task_id
       or (new.planner_id is distinct from old.planner_id and not app.task_moving())
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

-- Labels gehen über den Namen ins Ziel (fehlende werden angelegt). Zuweisungen ohne Zugriff im Ziel
-- und Knowledge-Base-Anhänge (die Datei bleibt im alten Planner) fallen weg.
create or replace function public.move_task(t uuid, p uuid, b uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  source uuid;
  task_title text;
  label_names text[];
  removed_assignees integer;
  removed_attachments integer;
begin
  select planner_id, title into source, task_title from public.tasks where id = t for update;
  if source is null then
    raise exception 'Task liegt in keinem Planner' using errcode = '42501';
  end if;
  if app.uid() is null
     or app.role_rank(app.planner_role_of(source, app.uid())) < app.role_rank('editor')
     or coalesce(app.role_rank(app.planner_role_of(p, app.uid())), 0) < app.role_rank('editor') then
    raise exception 'Keine Bearbeitungsrechte' using errcode = '42501';
  end if;
  if source = p then
    raise exception 'Task liegt bereits in diesem Planner' using errcode = '23514';
  end if;

  perform set_config('app.task_move', 'on', true);

  label_names := array(
    select l.name from public.task_labels tl join public.labels l on l.id = tl.label_id where tl.task_id = t);
  delete from public.task_labels where task_id = t;
  delete from public.task_attachments where task_id = t;
  get diagnostics removed_attachments = row_count;
  delete from public.task_assignees where task_id = t and app.planner_role_of(p, user_id) is null;
  get diagnostics removed_assignees = row_count;

  update public.tasks
     set planner_id = p,
         bucket_id = b,
         position = (select coalesce(max(position), 0) + 1024 from public.tasks where bucket_id = b)
   where id = t;

  update public.task_assignees set planner_id = p where task_id = t;
  update public.task_sections set planner_id = p where task_id = t;
  update public.section_items set planner_id = p
   where section_id in (select id from public.task_sections where task_id = t);
  update public.comments set planner_id = p where task_id = t;
  update public.task_files set planner_id = p where task_id = t;
  -- Fehlende Labels mit derselben Farbe anlegen
  insert into public.labels (planner_id, name, color)
  select p, l.name, l.color
    from public.labels l
   where l.planner_id = source and l.name = any (label_names)
     and not exists (select 1 from public.labels x where x.planner_id = p and lower(x.name) = lower(l.name));
  perform app.attach_labels(t, p, label_names);

  -- Clients im alten Planner sehen das Update nicht mehr (Realtime filtert auf den neuen Wert)
  insert into public.activity_log (planner_id, task_id, actor, action, payload)
  values (source, null, auth.uid(), 'task_moved_out', jsonb_build_object('task_id', t, 'title', task_title));

  perform set_config('app.task_move', '', true);
  return jsonb_build_object('removed_assignees', removed_assignees, 'removed_attachments', removed_attachments);
end
$$;
revoke execute on function public.move_task(uuid, uuid, uuid) from public, anon;
grant execute on function public.move_task(uuid, uuid, uuid) to authenticated, service_role;

alter publication supabase_realtime add table public.activity_log;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
