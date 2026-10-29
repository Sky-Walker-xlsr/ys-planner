-- ys-planner: Storage-Bucket, Storage-Policies, Realtime

-- ---------------------------------------------------------------------------
-- Storage: privater Bucket knowledge-base, Pfad {planner_id}/{kb_file_id}.md
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('knowledge-base', 'knowledge-base', false, 2097152, array['text/markdown'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Pfad muss exakt einer kb_files-Zeile desselben Planners entsprechen
create or replace function app.kb_object_planner(object_name text) returns uuid
language sql stable security definer set search_path = '' as $$
  select f.planner_id
    from public.kb_files f
   where f.storage_path = object_name
     and object_name ~* '^[0-9a-f-]{36}/[0-9a-f-]{36}\.md$'
     and f.planner_id = app.try_uuid(split_part(object_name, '/', 1))
$$;
revoke execute on function app.kb_object_planner(text) from public, anon;
grant execute on function app.kb_object_planner(text) to authenticated, service_role;

create policy kb_objects_select on storage.objects for select to authenticated
  using (bucket_id = 'knowledge-base' and app.has_role(app.kb_object_planner(name), 'viewer'));
create policy kb_objects_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'knowledge-base' and app.has_role(app.kb_object_planner(name), 'editor'));
create policy kb_objects_update on storage.objects for update to authenticated
  using (bucket_id = 'knowledge-base' and app.has_role(app.kb_object_planner(name), 'editor'))
  with check (bucket_id = 'knowledge-base' and app.has_role(app.kb_object_planner(name), 'editor'));
-- Löschen: die kb_files-Zeile ist dann evtl. schon weg, daher Planner aus dem Pfad
create policy kb_objects_delete on storage.objects for delete to authenticated
  using (bucket_id = 'knowledge-base' and app.has_role(app.try_uuid(split_part(name, '/', 1)), 'editor'));

-- ---------------------------------------------------------------------------
-- Realtime: Postgres Changes
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'folders', 'folder_members', 'planners', 'planner_members', 'favorites',
    'buckets', 'labels', 'tasks', 'task_assignees', 'task_labels',
    'task_sections', 'section_items', 'comments', 'kb_files', 'task_attachments'
  ] loop
    if not exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- Realtime: private Channels für Presence/Broadcast
-- Topic-Format: planner:{planner_id}
-- ---------------------------------------------------------------------------
create policy realtime_planner_read on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'planner:%'
    and app.has_role(app.try_uuid(substr(realtime.topic(), 9)), 'viewer')
  );
create policy realtime_planner_write on realtime.messages for insert to authenticated
  with check (
    realtime.topic() like 'planner:%'
    and app.has_role(app.try_uuid(substr(realtime.topic(), 9)), 'viewer')
  );
