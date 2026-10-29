-- ys-planner: Datei-Uploads an Tasks (privater Bucket task-files)
-- Pfad: {planner_id}/{task_id}/{task_file_id}. Bilder werden im Browser auf max. Full HD
-- verkleinert und als WebP hochgeladen.

create table public.task_files (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  planner_id uuid not null references public.planners (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200 and name !~ '[/\\]'),
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes between 0 and 10485760),
  storage_path text not null unique,
  uploaded_by uuid references public.users (id) on delete set null,
  uploaded_by_guest text,
  created_at timestamptz not null default now(),
  check (storage_path = planner_id::text || '/' || task_id::text || '/' || id::text)
);
create index task_files_task_idx on public.task_files (task_id, created_at);
create index task_files_planner_idx on public.task_files (planner_id);
create index task_files_uploaded_by_idx on public.task_files (uploaded_by);

-- planner_id und Pfad aus dem Task ableiten, Uploader aus dem JWT
create or replace function app.tg_task_files_before() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  task_planner uuid;
begin
  select planner_id into task_planner from public.tasks where id = new.task_id;
  if task_planner is null then
    raise exception 'Task nicht gefunden' using errcode = '23503';
  end if;
  new.planner_id := task_planner;
  new.storage_path := task_planner::text || '/' || new.task_id::text || '/' || new.id::text;
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

create trigger task_files_before before insert on public.task_files
  for each row execute function app.tg_task_files_before();

alter table public.task_files enable row level security;
-- Keine Updates: Dateien werden nur hochgeladen und gelöscht
revoke all on public.task_files from anon, authenticated;
grant select, insert, delete on public.task_files to authenticated;

create policy task_files_select on public.task_files for select to authenticated
  using (app.has_role(planner_id, 'viewer'));
create policy task_files_insert on public.task_files for insert to authenticated
  with check (app.has_role(planner_id, 'editor'));
create policy task_files_delete on public.task_files for delete to authenticated
  using (app.has_role(planner_id, 'editor'));

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('task-files', 'task-files', false, 10485760, null)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Pfad muss exakt einer task_files-Zeile entsprechen (Zeile wird vor dem Upload angelegt)
create or replace function app.task_file_planner(object_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select f.planner_id
    from public.task_files f
   where f.storage_path = object_name
     and f.planner_id = app.try_uuid(split_part(object_name, '/', 1))
$$;
revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;

create policy task_files_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'task-files' and app.has_role(app.task_file_planner(name), 'viewer'));
create policy task_files_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'task-files' and app.has_role(app.task_file_planner(name), 'editor'));
-- Löschen: die task_files-Zeile ist dann evtl. schon weg, daher Planner aus dem Pfad
create policy task_files_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'task-files' and app.has_role(app.try_uuid(split_part(name, '/', 1)), 'editor'));

alter publication supabase_realtime add table public.task_files;
