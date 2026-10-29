-- ys-planner: Supabase Storage abbauen – erst NACH erfolgreichem scripts/migrate-storage-to-r2.mjs
-- (siehe README › Storage-Migration). Die Buckets selbst werden danach im Dashboard gelöscht.

-- Alle Zeilen zeigen jetzt auf R2-Schlüssel
alter table public.kb_files add constraint kb_files_storage_path_check
  check (storage_path = 'kb/' || planner_id::text || '/' || id::text || '.md');
alter table public.task_files add constraint task_files_storage_path_check
  check (storage_path = 'tasks/' || task_id::text || '/' || id::text || '-' || name);

drop policy if exists kb_objects_select on storage.objects;
drop policy if exists kb_objects_insert on storage.objects;
drop policy if exists kb_objects_update on storage.objects;
drop policy if exists kb_objects_delete on storage.objects;
drop policy if exists task_files_objects_select on storage.objects;
drop policy if exists task_files_objects_insert on storage.objects;
drop policy if exists task_files_objects_delete on storage.objects;

drop function if exists app.kb_object_planner(text);
drop function if exists app.task_file_planner(text);
