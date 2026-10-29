-- ys-planner: Dateien liegen in Cloudflare R2 (Bucket planner-files), Zugriff nur über Route Handler.
--   kb/{planner_id}/{kb_file_id}.md
--   tasks/{task_id}/{file_id}-{dateiname}
-- Neue Zeilen bekommen ab jetzt R2-Schlüssel. Bestehende Zeilen stellt
-- scripts/migrate-storage-to-r2.mjs um (kopiert die Objekte und aktualisiert storage_path).
-- Die strengen Pfad-Checks folgen in 20261029000007 nach verifizierter Migration.

alter table public.kb_files drop constraint kb_files_check;
alter table public.task_files drop constraint task_files_check;

-- Mail-Anhänge dürfen bis 25 MB gross sein (manuelle Uploads begrenzt der Route Handler auf 10 MB)
alter table public.task_files drop constraint task_files_size_bytes_check;
alter table public.task_files add constraint task_files_size_bytes_check check (size_bytes between 0 and 26214400);

create or replace function app.tg_kb_files_before() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.planner_id is distinct from old.planner_id or new.id is distinct from old.id) then
    raise exception 'planner_id kann nicht geändert werden' using errcode = '42501';
  end if;
  new.storage_path := 'kb/' || new.planner_id::text || '/' || new.id::text || '.md';
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
  new.storage_path := 'tasks/' || new.task_id::text || '/' || new.id::text || '-' || new.name;
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

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
