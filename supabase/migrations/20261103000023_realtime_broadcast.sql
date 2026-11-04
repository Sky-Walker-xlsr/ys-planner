-- Realtime über Broadcast statt Postgres Changes.
--
-- Postgres Changes prüft jede Änderung pro Abonnent gegen RLS und läuft auf einem einzigen
-- Prozess; bei mehreren offenen Tabs kommen Änderungen spürbar verzögert an. Broadcast aus der
-- Datenbank prüft die Rechte einmal beim Beitritt (Policy realtime_planner_read auf
-- realtime.messages) und liefert danach direkt.
--
-- Jede Änderung an einem Planner oder seinen Zeilen geht als Event «db» an den privaten Channel
-- planner:{planner_id}: { op: INSERT | UPDATE | DELETE, table, row }.
-- Wird ein Task in einen anderen Planner verschoben, bekommt der alte Planner ein DELETE.

create or replace function app.tg_broadcast_planner() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  -- Über jsonb, weil planners keine Spalte planner_id hat
  col text := case when tg_table_name = 'planners' then 'id' else 'planner_id' end;
  old_row jsonb;
  new_row jsonb;
  old_p text;
  new_p text;
begin
  if tg_op <> 'INSERT' then
    old_row := to_jsonb(old);
    old_p := old_row ->> col;
  end if;
  if tg_op <> 'DELETE' then
    new_row := to_jsonb(new);
    new_p := new_row ->> col;
  end if;

  if old_p is not null and old_p is distinct from new_p then
    perform realtime.send(
      jsonb_build_object('op', 'DELETE', 'table', tg_table_name, 'row', old_row),
      'db', 'planner:' || old_p, true);
  end if;
  if new_p is not null then
    perform realtime.send(
      jsonb_build_object('op', tg_op, 'table', tg_table_name, 'row', new_row),
      'db', 'planner:' || new_p, true);
  end if;
  return null;
end
$$;
revoke execute on function app.tg_broadcast_planner() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array[
    'planners', 'buckets', 'labels', 'tasks', 'task_assignees', 'task_labels', 'task_sections',
    'section_items', 'comments', 'kb_files', 'task_attachments', 'task_files', 'planner_members'
  ] loop
    execute format(
      'create or replace trigger %I after insert or update or delete on public.%I
         for each row execute function app.tg_broadcast_planner()',
      t || '_broadcast', t);
  end loop;
end
$$;
