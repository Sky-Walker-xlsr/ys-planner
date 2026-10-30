-- RLS-Tests für ys-planner.
-- Läuft vollständig in einer Transaktion und endet mit ROLLBACK: es bleibt
-- nichts in der Datenbank zurück (auch gefahrlos gegen Produktion).
-- Ausführen: npm run test:rls   (benötigt DATABASE_URL, Rolle postgres)

begin;

create temp table rls_results (
  n serial,
  actor text,
  label text,
  passed boolean,
  detail text
) on commit drop;

-- Claims für einen eingeloggten User
create function pg_temp.user_claims(u uuid) returns jsonb language sql as $$
  select jsonb_build_object('sub', u, 'role', 'authenticated', 'aud', 'authenticated')
$$;

-- Claims für einen Gast
create function pg_temp.guest_claims(g uuid, link uuid, p uuid, perm text, gname text) returns jsonb language sql as $$
  select jsonb_build_object('sub', g, 'role', 'authenticated', 'aud', 'authenticated',
    'share_link_id', link, 'planner_id', p, 'share_permission', perm, 'guest_name', gname)
$$;

-- Führt sql als 'authenticated' mit den angegebenen Claims aus und rollt die
-- Wirkung immer zurück. mode: 'rows' (Anzahl sichtbarer Zeilen = expected),
-- 'can' (Statement betrifft >= 1 Zeile, ohne Fehler), 'cannot' (Fehler oder 0 Zeilen).
create function pg_temp.check(actor text, claims jsonb, label text, mode text, sql text, expected int default null)
returns void language plpgsql as $$
declare
  n bigint;
  ok boolean;
  detail text;
begin
  begin
    perform set_config('request.jwt.claims', claims::text, true);
    perform set_config('role', 'authenticated', true);
    if mode = 'rows' then
      execute 'select count(*) from (' || sql || ') _x' into n;
    else
      execute sql;
      get diagnostics n = row_count;
    end if;
    raise exception using errcode = 'P0001', message = '__rollback__', detail = n::text;
  exception when others then
    if sqlerrm = '__rollback__' then
      get stacked diagnostics detail = pg_exception_detail;
      n := detail::bigint;
      ok := case mode
              when 'rows' then n = expected
              when 'can' then n >= 1
              when 'cannot' then n = 0
            end;
      detail := 'rows=' || n;
    else
      ok := (mode = 'cannot');
      detail := 'error: ' || sqlerrm;
    end if;
  end;
  insert into rls_results (actor, label, passed, detail) values (actor, label, ok, detail);
end
$$;

-- ---------------------------------------------------------------------------
-- Fixtures (als postgres, ohne JWT)
-- ---------------------------------------------------------------------------
insert into public.users (id, zitadel_sub, email, display_name) values
  ('a0000000-0000-4000-8000-000000000001', 'test|owner',   'owner@test.local',   'T Owner'),
  ('a0000000-0000-4000-8000-000000000002', 'test|editor',  'editor@test.local',  'T Editor'),
  ('a0000000-0000-4000-8000-000000000003', 'test|viewer',  'viewer@test.local',  'T Viewer'),
  ('a0000000-0000-4000-8000-000000000004', 'test|folder',  'folder@test.local',  'T Ordner'),
  ('a0000000-0000-4000-8000-000000000005', 'test|stranger','stranger@test.local','T Fremd');

insert into public.folders (id, owner_id, name) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'T-Ordner');
insert into public.folder_members (folder_id, user_id, role) values
  ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000004', 'editor');

-- P im Ordner, P2 ohne Ordner (beide von Owner)
insert into public.planners (id, owner_id, folder_id, name) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000001', 'T-P'),
  ('c0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000001', null, 'T-P2');

insert into public.planner_members (planner_id, user_id, role) values
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'editor'),
  ('c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'viewer');

insert into public.buckets (id, planner_id, name) values
  ('d0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'B1'),
  ('d0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'B2');

insert into public.tasks (id, planner_id, bucket_id, title) values
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'd0000000-0000-4000-8000-000000000001', 'Task P'),
  ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'd0000000-0000-4000-8000-000000000002', 'Task P2');

insert into public.comments (task_id, planner_id, author_user_id, body) values
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'Kommentar Editor');

insert into public.kb_files (id, planner_id, name, storage_path) values
  ('f0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Doku.md',
   'c0000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000001.md'),
  ('f0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Ohne-Inhalt.md',
   'c0000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000002.md');

insert into public.task_files (id, task_id, planner_id, name, size_bytes, storage_path) values
  ('70000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Foto.webp', 1000, '');

insert into public.user_sender_emails (user_id, email, confirmed_at) values
  ('a0000000-0000-4000-8000-000000000005', 'bestaetigt@test.local', now()),
  ('a0000000-0000-4000-8000-000000000005', 'offen@test.local', null);

-- Eingang (Tasks ohne Planner)
insert into public.tasks (id, owner_id, title) values
  ('e1000000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-000000000003', 'Inbox Leser'),
  ('e1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'Inbox Bearbeiter');
insert into public.user_tags (task_id, user_id, name) values
  ('e1000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000002', 'kunde-x');
-- Bereits verschobener Inbox-Task (Trigger: Tag → Label, Datei → tasks/)
insert into public.tasks (id, owner_id, title) values
  ('e1000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', 'Inbox verschoben');
insert into public.user_tags (task_id, user_id, name) values
  ('e1000000-0000-4000-8000-000000000004', 'a0000000-0000-4000-8000-000000000002', 'projekt-y');
insert into public.task_files (task_id, name, size_bytes, storage_path) values
  ('e1000000-0000-4000-8000-000000000004', 'scan.pdf', 10, '');
update public.tasks set planner_id = 'c0000000-0000-4000-8000-000000000001', bucket_id = 'd0000000-0000-4000-8000-000000000001'
 where id = 'e1000000-0000-4000-8000-000000000004';

-- Share-Links: read, edit, widerrufen, abgelaufen
insert into public.share_links (id, planner_id, token_hash, token_ciphertext, permission, revoked_at, expires_at, created_by) values
  ('90000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'h1', 'c1', 'read', null, null, 'a0000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'h2', 'c2', 'edit', null, now() + interval '1 day', 'a0000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'h3', 'c3', 'edit', now(), null, 'a0000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'h4', 'c4', 'edit', null, now() - interval '1 hour', 'a0000000-0000-4000-8000-000000000001');

-- Erinnerung des Bearbeiters (Zeitpunkt in der Zukunft, wird vom Claim nicht erfasst)
insert into public.task_reminders (task_id, user_id, remind_at) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', now() + interval '1 day');

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------
do $$
declare
  P  constant text := '''c0000000-0000-4000-8000-000000000001''';
  P2 constant text := '''c0000000-0000-4000-8000-000000000002''';
  B1 constant text := '''d0000000-0000-4000-8000-000000000001''';
  T1 constant text := '''e0000000-0000-4000-8000-000000000001''';
  T2 constant text := '''e0000000-0000-4000-8000-000000000002''';
  FO constant text := '''b0000000-0000-4000-8000-000000000001''';

  owner    jsonb := pg_temp.user_claims('a0000000-0000-4000-8000-000000000001');
  editor   jsonb := pg_temp.user_claims('a0000000-0000-4000-8000-000000000002');
  viewer   jsonb := pg_temp.user_claims('a0000000-0000-4000-8000-000000000003');
  fmember  jsonb := pg_temp.user_claims('a0000000-0000-4000-8000-000000000004');
  stranger jsonb := pg_temp.user_claims('a0000000-0000-4000-8000-000000000005');
  g_read   jsonb := pg_temp.guest_claims('a1000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'read', 'Gast Lesen');
  g_edit   jsonb := pg_temp.guest_claims('a1000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'edit', 'Gast Bearbeiten');
  g_revoked jsonb := pg_temp.guest_claims('a1000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'edit', 'Widerrufen');
  g_expired jsonb := pg_temp.guest_claims('a1000000-0000-4000-8000-000000000004', '90000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'edit', 'Abgelaufen');
  g_forged jsonb := pg_temp.guest_claims('a1000000-0000-4000-8000-000000000005', '90000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000002', 'edit', 'Gefälscht');

  ins_task text := 'insert into public.tasks (planner_id, bucket_id, title) values (' || P || ', ' || B1 || ', ''Neu'')';
  ins_task_p2 text := 'insert into public.tasks (planner_id, bucket_id, title) values (' || P2 || ', ''d0000000-0000-4000-8000-000000000002'', ''Neu'')';
  upd_task text := 'update public.tasks set title = ''Geändert'' where id = ' || T1;
  del_task text := 'delete from public.tasks where id = ' || T1;
  ins_bucket text := 'insert into public.buckets (planner_id, name) values (' || P || ', ''Neu'')';
  ins_label text := 'insert into public.labels (planner_id, name, color) values (' || P || ', ''L'', ''blue'')';
  ins_section text := 'insert into public.task_sections (task_id, planner_id, title) values (' || T1 || ', ' || P || ', ''S'')';
  ins_comment text := 'insert into public.comments (task_id, planner_id, body) values (' || T1 || ', ' || P || ', ''Hallo'')';
  upd_editor_comment text := 'update public.comments set body = ''x'' where task_id = ' || T1;
  ins_kb text := 'insert into public.kb_files (planner_id, name, storage_path) values (' || P || ', ''Neu.md'', '''')';
  upd_planner text := 'update public.planners set name = ''Umbenannt'' where id = ' || P;
  del_planner text := 'delete from public.planners where id = ' || P;
  ins_member text := 'insert into public.planner_members (planner_id, user_id, role) values (' || P || ', ''a0000000-0000-4000-8000-000000000005'', ''viewer'')';
  demote_creator text := 'update public.planner_members set role = ''editor'' where planner_id = ' || P || ' and user_id = ''a0000000-0000-4000-8000-000000000001''';
  sel_links text := 'select id from public.share_links where planner_id = ' || P;
  sel_link_hash text := 'select token_hash from public.share_links where planner_id = ' || P;
  revoke_link text := 'update public.share_links set revoked_at = now() where id = ''90000000-0000-4000-8000-000000000001''';
  ins_link text := 'insert into public.share_links (planner_id, token_hash, token_ciphertext, created_by) values (' || P || ', ''x'', ''y'', ''a0000000-0000-4000-8000-000000000001'')';
  ins_planner text := 'insert into public.planners (owner_id, name) values (''a0000000-0000-4000-8000-000000000005'', ''Eigener'')';
  ins_planner_guest text := 'insert into public.planners (owner_id, name) values (''a1000000-0000-4000-8000-000000000002'', ''Gast-Planner'')';
  move_p2_into_folder text := 'update public.planners set folder_id = ' || FO || ' where id = ' || P2;
  rename_folder text := 'update public.folders set name = ''Neu'' where id = ' || FO;
  ins_folder_member text := 'insert into public.folder_members (folder_id, user_id, role) values (' || FO || ', ''a0000000-0000-4000-8000-000000000005'', ''viewer'')';
  -- R2-Routen: Lesen = Zeile per RLS sichtbar, Schreiben = planner_role() mindestens editor
  sel_obj text := 'select id from public.kb_files where id = ''f0000000-0000-4000-8000-000000000001''';
  r2_write text := 'select 1 where public.planner_role(' || P || ') in (''owner'', ''editor'')';
  ins_assignee_stranger text := 'insert into public.task_assignees (task_id, user_id, planner_id) values (' || T1 || ', ''a0000000-0000-4000-8000-000000000005'', ' || P || ')';
  ins_assignee_editor text := 'insert into public.task_assignees (task_id, user_id, planner_id) values (' || T1 || ', ''a0000000-0000-4000-8000-000000000002'', ' || P || ')';
  sel_users text := 'select id from public.users where email like ''%@test.local''';
  ins_task_file text := 'insert into public.task_files (id, task_id, planner_id, name, size_bytes, storage_path) values (''70000000-0000-4000-8000-000000000002'', ' || T1 || ', ' || P || ', ''Plan.pdf'', 10, '''')';
  sel_task_files text := 'select id from public.task_files where task_id = ' || T1;
  del_task_file text := 'delete from public.task_files where id = ''70000000-0000-4000-8000-000000000001''';
  upd_task_file text := 'update public.task_files set name = ''x'' where id = ''70000000-0000-4000-8000-000000000001''';
  sel_tf_obj text := 'select id from public.task_files where id = ''70000000-0000-4000-8000-000000000001''';
begin

  -- Owner -------------------------------------------------------------------
  perform pg_temp.check('owner', owner, 'sieht beide Planner', 'rows', 'select id from public.planners where id in (' || P || ',' || P2 || ')', 2);
  perform pg_temp.check('owner', owner, 'Planner umbenennen', 'can', upd_planner);
  perform pg_temp.check('owner', owner, 'Planner löschen', 'can', del_planner);
  perform pg_temp.check('owner', owner, 'Mitglied einladen', 'can', ins_member);
  perform pg_temp.check('owner', owner, 'Ersteller kann nicht degradiert werden', 'cannot', demote_creator);
  perform pg_temp.check('owner', owner, 'Share-Links lesen', 'rows', sel_links, 4);
  perform pg_temp.check('owner', owner, 'Token-Hash nicht lesbar', 'cannot', sel_link_hash);
  perform pg_temp.check('owner', owner, 'Share-Link nicht direkt einfügen (nur Server)', 'cannot', ins_link);
  perform pg_temp.check('owner', owner, 'Share-Link widerrufen', 'can', revoke_link);
  perform pg_temp.check('owner', owner, 'Ordner umbenennen', 'can', rename_folder);
  perform pg_temp.check('owner', owner, 'Ordner freigeben', 'can', ins_folder_member);
  perform pg_temp.check('owner', owner, 'P2 in eigenen Ordner verschieben', 'can', move_p2_into_folder);
  perform pg_temp.check('owner', owner, 'Task anlegen', 'can', ins_task);
  perform pg_temp.check('owner', owner, 'Fremden zuweisen verboten', 'cannot', ins_assignee_stranger);

  -- Bearbeiter --------------------------------------------------------------
  perform pg_temp.check('editor', editor, 'sieht P', 'rows', 'select id from public.planners where id = ' || P, 1);
  perform pg_temp.check('editor', editor, 'sieht P2 nicht', 'rows', 'select id from public.planners where id = ' || P2, 0);
  perform pg_temp.check('editor', editor, 'Task anlegen', 'can', ins_task);
  perform pg_temp.check('editor', editor, 'Task ändern', 'can', upd_task);
  perform pg_temp.check('editor', editor, 'Task löschen', 'can', del_task);
  perform pg_temp.check('editor', editor, 'Bucket anlegen', 'can', ins_bucket);
  perform pg_temp.check('editor', editor, 'Label anlegen', 'can', ins_label);
  perform pg_temp.check('editor', editor, 'Abschnitt anlegen', 'can', ins_section);
  perform pg_temp.check('editor', editor, 'Kommentieren', 'can', ins_comment);
  perform pg_temp.check('editor', editor, 'eigenen Kommentar ändern', 'can', upd_editor_comment);
  perform pg_temp.check('editor', editor, 'KB-Datei anlegen', 'can', ins_kb);
  perform pg_temp.check('editor', editor, 'R2-Route: Schreibrecht', 'rows', r2_write, 1);
  perform pg_temp.check('editor', editor, 'sich selbst zuweisen', 'can', ins_assignee_editor);
  perform pg_temp.check('editor', editor, 'Task-Datei anlegen', 'can', ins_task_file);
  perform pg_temp.check('editor', editor, 'Task-Datei löschen', 'can', del_task_file);
  perform pg_temp.check('editor', editor, 'Task-Datei ändern verboten', 'cannot', upd_task_file);
  perform pg_temp.check('editor', editor, 'Planner umbenennen verboten', 'cannot', upd_planner);
  perform pg_temp.check('editor', editor, 'Planner löschen verboten', 'cannot', del_planner);
  perform pg_temp.check('editor', editor, 'Mitglieder einladen verboten', 'cannot', ins_member);
  perform pg_temp.check('editor', editor, 'Share-Links unsichtbar', 'rows', sel_links, 0);
  perform pg_temp.check('editor', editor, 'Share-Link widerrufen verboten', 'cannot', revoke_link);

  -- Leser -------------------------------------------------------------------
  perform pg_temp.check('viewer', viewer, 'sieht Tasks von P', 'rows', 'select id from public.tasks where planner_id = ' || P, 2);
  perform pg_temp.check('viewer', viewer, 'sieht Kommentare', 'rows', 'select id from public.comments where planner_id = ' || P, 1);
  perform pg_temp.check('viewer', viewer, 'R2-Route: liest KB-Datei', 'rows', sel_obj, 1);
  perform pg_temp.check('viewer', viewer, 'sieht Task-Dateien', 'rows', sel_task_files, 1);
  perform pg_temp.check('viewer', viewer, 'R2-Route: liest Task-Datei', 'rows', sel_tf_obj, 1);
  perform pg_temp.check('viewer', viewer, 'Task-Datei anlegen verboten', 'cannot', ins_task_file);
  perform pg_temp.check('viewer', viewer, 'Task-Datei löschen verboten', 'cannot', del_task_file);
  perform pg_temp.check('viewer', viewer, 'Task anlegen verboten', 'cannot', ins_task);
  perform pg_temp.check('viewer', viewer, 'Task ändern verboten', 'cannot', upd_task);
  perform pg_temp.check('viewer', viewer, 'Task löschen verboten', 'cannot', del_task);
  perform pg_temp.check('viewer', viewer, 'Kommentieren verboten', 'cannot', ins_comment);
  perform pg_temp.check('viewer', viewer, 'KB-Datei anlegen verboten', 'cannot', ins_kb);
  perform pg_temp.check('viewer', viewer, 'R2-Route: kein Schreibrecht', 'rows', r2_write, 0);
  perform pg_temp.check('viewer', viewer, 'Bucket anlegen verboten', 'cannot', ins_bucket);
  perform pg_temp.check('viewer', viewer, 'fremden Kommentar ändern verboten', 'cannot', upd_editor_comment);

  -- Ordner-Mitglied (Bearbeiter via Ordner) ----------------------------------
  perform pg_temp.check('folder', fmember, 'sieht P via Ordner', 'rows', 'select id from public.planners where id = ' || P, 1);
  perform pg_temp.check('folder', fmember, 'sieht P2 nicht', 'rows', 'select id from public.planners where id = ' || P2, 0);
  perform pg_temp.check('folder', fmember, 'sieht Ordner', 'rows', 'select id from public.folders where id = ' || FO, 1);
  perform pg_temp.check('folder', fmember, 'Rolle = editor', 'rows', 'select 1 where public.planner_role(' || P || ') = ''editor''', 1);
  perform pg_temp.check('folder', fmember, 'Task anlegen', 'can', ins_task);
  perform pg_temp.check('folder', fmember, 'Ordner umbenennen verboten', 'cannot', rename_folder);
  perform pg_temp.check('folder', fmember, 'Ordner freigeben verboten', 'cannot', ins_folder_member);
  perform pg_temp.check('folder', fmember, 'Planner löschen verboten', 'cannot', del_planner);

  -- Erinnerungen -------------------------------------------------------------
  perform pg_temp.check('viewer', viewer, 'Erinnerung: Leser darf eigene setzen', 'can', 'insert into public.task_reminders (task_id, user_id, remind_at) values (' || T1 || ', ''a0000000-0000-4000-8000-000000000003'', now())');
  perform pg_temp.check('viewer', viewer, 'Erinnerung: für andere verboten', 'cannot', 'insert into public.task_reminders (task_id, user_id, remind_at) values (' || T1 || ', ''a0000000-0000-4000-8000-000000000001'', now())');
  perform pg_temp.check('stranger', stranger, 'Erinnerung: an fremden Task verboten', 'cannot', 'insert into public.task_reminders (task_id, user_id, remind_at) values (' || T1 || ', ''a0000000-0000-4000-8000-000000000005'', now())');
  perform pg_temp.check('guest-edit', g_edit, 'Erinnerung: für Gäste verboten', 'cannot', 'insert into public.task_reminders (task_id, user_id, remind_at) values (' || T1 || ', ''a1000000-0000-4000-8000-000000000002'', now())');
  perform pg_temp.check('editor', editor, 'Erinnerung: sieht eigene', 'rows', 'select task_id from public.task_reminders', 1);
  perform pg_temp.check('viewer', viewer, 'Erinnerung: fremde unsichtbar', 'rows', 'select task_id from public.task_reminders', 0);
  perform pg_temp.check('editor', editor, 'Erinnerung: Zeitpunkt ändern', 'can', 'update public.task_reminders set remind_at = now() where task_id = ' || T1);
  perform pg_temp.check('editor', editor, 'Erinnerung: sent_at setzen verboten', 'cannot', 'update public.task_reminders set sent_at = now() where task_id = ' || T1);
  perform pg_temp.check('viewer', viewer, 'Erinnerung: fremde löschen verboten', 'cannot', 'delete from public.task_reminders where task_id = ' || T1);
  perform pg_temp.check('editor', editor, 'Erinnerung: eigene löschen', 'can', 'delete from public.task_reminders where task_id = ' || T1);
  perform pg_temp.check('owner', owner, 'Erinnerung: Claim nur für Service-Role', 'cannot', 'select public.claim_due_reminders(10)');

  -- Eingang ------------------------------------------------------------------
  perform pg_temp.check('viewer', viewer, 'Eingang: sieht eigenen Inbox-Task', 'rows', 'select id from public.tasks where planner_id is null', 1);
  perform pg_temp.check('viewer', viewer, 'Eingang: eigenen Inbox-Task ändern', 'can', 'update public.tasks set title = ''x'' where id = ''e1000000-0000-4000-8000-000000000003''');
  perform pg_temp.check('viewer', viewer, 'Eingang: Inbox-Task anlegen', 'can', 'insert into public.tasks (title, owner_id) values (''Neu'', ''a0000000-0000-4000-8000-000000000003'')');
  perform pg_temp.check('viewer', viewer, 'Eingang: Verschieben ohne Bearbeiter-Rolle verboten', 'cannot', 'update public.tasks set planner_id = ' || P || ', bucket_id = ' || B1 || ' where id = ''e1000000-0000-4000-8000-000000000003''');
  perform pg_temp.check('viewer', viewer, 'Eingang: fremde Tags unsichtbar', 'rows', 'select name from public.user_tags', 0);
  perform pg_temp.check('editor', editor, 'Eingang: fremden Inbox-Task unsichtbar', 'rows', 'select id from public.tasks where id = ''e1000000-0000-4000-8000-000000000003''', 0);
  perform pg_temp.check('editor', editor, 'Eingang: fremden Inbox-Task ändern verboten', 'cannot', 'update public.tasks set title = ''x'' where id = ''e1000000-0000-4000-8000-000000000003''');
  perform pg_temp.check('editor', editor, 'Eingang: in Planner verschieben (Bearbeiter)', 'can', 'update public.tasks set planner_id = ' || P || ', bucket_id = ' || B1 || ' where id = ''e1000000-0000-4000-8000-000000000002''');
  perform pg_temp.check('editor', editor, 'Eingang: Tag wurde beim Verschieben Label', 'rows', 'select 1 from public.task_labels tl join public.labels l on l.id = tl.label_id where tl.task_id = ''e1000000-0000-4000-8000-000000000004'' and l.name = ''projekt-y''', 1);
  perform pg_temp.check('editor', editor, 'Eingang: Datei-Pfad nach Verschieben tasks/…', 'rows', 'select 1 from public.task_files where task_id = ''e1000000-0000-4000-8000-000000000004'' and storage_path like ''tasks/%'' and planner_id = ' || P, 1);
  perform pg_temp.check('editor', editor, 'Eingang: Task-Datei an eigenen Inbox-Task', 'can', 'insert into public.task_files (task_id, name, size_bytes, storage_path) values (''e1000000-0000-4000-8000-000000000002'', ''a.pdf'', 1, '''')');
  perform pg_temp.check('viewer', viewer, 'Eingang: Task-Datei an fremden Inbox-Task verboten', 'cannot', 'insert into public.task_files (task_id, name, size_bytes, storage_path) values (''e1000000-0000-4000-8000-000000000002'', ''a.pdf'', 1, '''')');
  perform pg_temp.check('stranger', stranger, 'Eingang: keine fremden Inbox-Tasks', 'rows', 'select id from public.tasks where planner_id is null', 0);
  perform pg_temp.check('owner', owner, 'Eingang: Owner von P sieht fremde Inbox-Tasks nicht', 'rows', 'select id from public.tasks where planner_id is null', 0);
  perform pg_temp.check('owner', owner, 'Absender-Adresse direkt anlegen verboten (nur Server)', 'cannot', 'insert into public.user_sender_emails (user_id, email, confirmed_at) values (''a0000000-0000-4000-8000-000000000001'', ''x@y.ch'', now())');

  -- Fremder -----------------------------------------------------------------
  perform pg_temp.check('stranger', stranger, 'sieht keine fremden Planner', 'rows', 'select id from public.planners where id in (' || P || ',' || P2 || ')', 0);
  perform pg_temp.check('stranger', stranger, 'sieht keine Tasks', 'rows', 'select id from public.tasks where id in (' || T1 || ',' || T2 || ')', 0);
  perform pg_temp.check('stranger', stranger, 'sieht keinen Ordner', 'rows', 'select id from public.folders where id = ' || FO, 0);
  perform pg_temp.check('stranger', stranger, 'R2-Route: liest keine KB-Datei', 'rows', sel_obj, 0);
  perform pg_temp.check('stranger', stranger, 'sieht keine Task-Dateien', 'rows', sel_task_files, 0);
  perform pg_temp.check('stranger', stranger, 'R2-Route: liest keine Task-Datei', 'rows', sel_tf_obj, 0);
  perform pg_temp.check('stranger', stranger, 'Task anlegen verboten', 'cannot', ins_task);
  perform pg_temp.check('stranger', stranger, 'Mitglied werden verboten', 'cannot', ins_member);
  perform pg_temp.check('stranger', stranger, 'eigenen Planner anlegen', 'can', ins_planner);
  perform pg_temp.check('stranger', stranger, 'eigenen Ordner anlegen', 'can', 'insert into public.folders (owner_id, name) values (''a0000000-0000-4000-8000-000000000005'', ''Mein Ordner'')');
  -- wie die App (.insert().select()): RETURNING läuft vor dem Owner-Mitglied-Trigger
  perform pg_temp.check('stranger', stranger, 'Planner anlegen mit RETURNING', 'can', ins_planner || ' returning id');
  perform pg_temp.check('stranger', stranger, 'Ordner anlegen mit RETURNING', 'can', 'insert into public.folders (owner_id, name) values (''a0000000-0000-4000-8000-000000000005'', ''Mein Ordner'') returning id');
  perform pg_temp.check('stranger', stranger, 'sieht nur sich selbst', 'rows', sel_users, 1);
  perform pg_temp.check('editor', editor, 'sieht Personen aus gemeinsamen Plannern/Ordnern', 'rows', sel_users, 4);
  perform pg_temp.check('stranger', stranger, 'Suche: fremde Person per Teilstring nicht auffindbar', 'rows', 'select id from public.search_users(''owner'')', 0);
  perform pg_temp.check('stranger', stranger, 'Suche: fremde Person per exakter E-Mail auffindbar', 'rows', 'select id from public.search_users(''owner@test.local'')', 1);
  perform pg_temp.check('editor', editor, 'Suche: bekannte Person per Teilstring auffindbar', 'rows', 'select id from public.search_users(''owner'')', 1);
  perform pg_temp.check('guest-edit', g_edit, 'Suche: Gäste finden niemanden', 'rows', 'select id from public.search_users(''owner@test.local'')', 0);
  perform pg_temp.check('owner', owner, 'Zitadel-ID nicht lesbar', 'cannot', 'select zitadel_sub from public.users');
  perform pg_temp.check('owner', owner, 'users nicht direkt schreibbar', 'cannot', 'update public.users set display_name = ''x'' where id = ''a0000000-0000-4000-8000-000000000001''');
  perform pg_temp.check('stranger', stranger, 'notify_email: fremde Adresse verboten', 'cannot', 'update public.user_settings set notify_email = ''opfer@evil.ch'' where user_id = ''a0000000-0000-4000-8000-000000000005''');
  perform pg_temp.check('stranger', stranger, 'notify_email: unbestätigte Adresse verboten', 'cannot', 'update public.user_settings set notify_email = ''offen@test.local'' where user_id = ''a0000000-0000-4000-8000-000000000005''');
  perform pg_temp.check('stranger', stranger, 'notify_email: bestätigte Adresse erlaubt', 'can', 'update public.user_settings set notify_email = ''bestaetigt@test.local'' where user_id = ''a0000000-0000-4000-8000-000000000005''');
  perform pg_temp.check('stranger', stranger, 'Rate-Limit-Tabelle nicht lesbar', 'cannot', 'select * from public.mail_rate_limits');
  perform pg_temp.check('stranger', stranger, 'Rate-Limit-Funktion nicht aufrufbar', 'cannot', 'select public.mail_rate_hit(''a0000000-0000-4000-8000-000000000005'', 1000)');
  perform pg_temp.check('stranger', stranger, 'Planner in fremden Ordner verboten', 'cannot',
    'insert into public.planners (owner_id, folder_id, name) values (''a0000000-0000-4000-8000-000000000005'', ' || FO || ', ''X'')');

  -- Gast read ---------------------------------------------------------------
  perform pg_temp.check('guest-read', g_read, 'sieht P', 'rows', 'select id from public.planners where id = ' || P, 1);
  perform pg_temp.check('guest-read', g_read, 'sieht Tasks von P', 'rows', 'select id from public.tasks where planner_id = ' || P, 2);
  perform pg_temp.check('guest-read', g_read, 'sieht P2 nicht', 'rows', 'select id from public.tasks where id = ' || T2, 0);
  perform pg_temp.check('guest-read', g_read, 'R2-Route: liest KB-Datei', 'rows', sel_obj, 1);
  perform pg_temp.check('guest-read', g_read, 'R2-Route: liest Task-Datei', 'rows', sel_tf_obj, 1);
  perform pg_temp.check('guest-read', g_read, 'Task-Datei anlegen verboten', 'cannot', ins_task_file);
  perform pg_temp.check('guest-edit', g_edit, 'Task-Datei anlegen', 'can', ins_task_file);
  perform pg_temp.check('guest-edit', g_edit, 'Eingang: Inbox-Task anlegen verboten', 'cannot', 'insert into public.tasks (title, owner_id) values (''Neu'', ''a1000000-0000-4000-8000-000000000002'')');
  perform pg_temp.check('guest-edit', g_edit, 'Eingang: keine Inbox-Tasks sichtbar', 'rows', 'select id from public.tasks where planner_id is null', 0);
  perform pg_temp.check('guest-revoked', g_revoked, 'Task-Datei anlegen verboten', 'cannot', ins_task_file);
  perform pg_temp.check('guest-read', g_read, 'sieht nur Mitglieder (owner, editor, viewer, folder)', 'rows', sel_users, 4);
  perform pg_temp.check('guest-read', g_read, 'Task anlegen verboten', 'cannot', ins_task);
  perform pg_temp.check('guest-read', g_read, 'R2-Route: kein Schreibrecht', 'rows', r2_write, 0);
  perform pg_temp.check('guest-read', g_read, 'Kommentieren verboten', 'cannot', ins_comment);
  perform pg_temp.check('guest-read', g_read, 'Share-Links unsichtbar', 'rows', sel_links, 0);
  perform pg_temp.check('guest-read', g_read, 'Ordner unsichtbar', 'rows', 'select id from public.folders', 0);
  perform pg_temp.check('guest-read', g_read, 'Ordner-Mitglieder des eigenen Planners sichtbar', 'rows', 'select user_id from public.folder_members where folder_id = ' || FO, 2);
  perform pg_temp.check('guest-forged', g_forged, 'keine Ordner-Mitglieder mit gefälschtem Claim', 'rows', 'select user_id from public.folder_members', 0);
  perform pg_temp.check('guest-read', g_read, 'Planner anlegen verboten', 'cannot', ins_planner_guest);

  -- Gast edit ---------------------------------------------------------------
  perform pg_temp.check('guest-edit', g_edit, 'Rolle = editor', 'rows', 'select 1 where public.planner_role(' || P || ') = ''editor''', 1);
  perform pg_temp.check('guest-edit', g_edit, 'Task anlegen', 'can', ins_task);
  perform pg_temp.check('guest-edit', g_edit, 'Task ändern', 'can', upd_task);
  perform pg_temp.check('guest-edit', g_edit, 'Kommentieren (mit Gastname)', 'can', ins_comment);
  perform pg_temp.check('guest-edit', g_edit, 'Bucket anlegen', 'can', ins_bucket);
  perform pg_temp.check('guest-edit', g_edit, 'KB-Datei anlegen', 'can', ins_kb);
  perform pg_temp.check('guest-edit', g_edit, 'R2-Route: Schreibrecht', 'rows', r2_write, 1);
  perform pg_temp.check('guest-edit', g_edit, 'R2-Route: liest KB-Datei', 'rows', sel_obj, 1);
  perform pg_temp.check('guest-edit', g_edit, 'fremden Kommentar ändern verboten', 'cannot', upd_editor_comment);
  perform pg_temp.check('guest-edit', g_edit, 'Planner umbenennen verboten', 'cannot', upd_planner);
  perform pg_temp.check('guest-edit', g_edit, 'Planner löschen verboten', 'cannot', del_planner);
  perform pg_temp.check('guest-edit', g_edit, 'Mitglieder einladen verboten', 'cannot', ins_member);
  perform pg_temp.check('guest-edit', g_edit, 'Share-Link widerrufen verboten', 'cannot', revoke_link);
  perform pg_temp.check('guest-edit', g_edit, 'Task in P2 verboten', 'cannot', ins_task_p2);
  perform pg_temp.check('guest-edit', g_edit, 'Planner anlegen verboten', 'cannot', ins_planner_guest);
  perform pg_temp.check('guest-edit', g_edit, 'Favoriten verboten', 'cannot',
    'insert into public.favorites (user_id, planner_id) values (''a1000000-0000-4000-8000-000000000002'', ' || P || ')');

  -- Ungültige Gastzugänge ---------------------------------------------------
  perform pg_temp.check('guest-revoked', g_revoked, 'widerrufener Link sieht nichts', 'rows', 'select id from public.tasks where planner_id = ' || P, 0);
  perform pg_temp.check('guest-expired', g_expired, 'abgelaufener Link sieht nichts', 'rows', 'select id from public.tasks where planner_id = ' || P, 0);
  perform pg_temp.check('guest-revoked', g_revoked, 'R2-Route: widerrufener Link liest keine Datei', 'rows', sel_obj, 0);
  perform pg_temp.check('guest-expired', g_expired, 'R2-Route: abgelaufener Link liest keine Datei', 'rows', sel_tf_obj, 0);
  perform pg_temp.check('guest-forged', g_forged, 'R2-Route: gefälschter Claim liest keine Datei', 'rows', sel_obj, 0);
  perform pg_temp.check('guest-revoked', g_revoked, 'R2-Route: widerrufener Link ohne Schreibrecht', 'rows', r2_write, 0);
  perform pg_temp.check('guest-forged', g_forged, 'gefälschter planner_id-Claim sieht P2 nicht', 'rows', 'select id from public.tasks where planner_id = ' || P2, 0);
  perform pg_temp.check('guest-forged', g_forged, 'gefälschter Claim sieht auch P nicht', 'rows', 'select id from public.tasks where planner_id = ' || P, 0);
end
$$;

-- Höchste Rolle: Leser direkt + Bearbeiter via Ordner => editor
insert into public.folder_members (folder_id, user_id, role)
values ('b0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', 'editor');
select pg_temp.check('viewer', pg_temp.user_claims('a0000000-0000-4000-8000-000000000003'),
  'Leser direkt + Bearbeiter via Ordner = editor', 'rows',
  'select 1 where public.planner_role(''c0000000-0000-4000-8000-000000000001'') = ''editor''', 1);

-- Gast-Kommentar trägt den Gastnamen statt einer User-ID
select pg_temp.check('guest-edit',
  pg_temp.guest_claims('a1000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'edit', 'Gast Bearbeiten'),
  'Gast-Kommentar: author_user_id null, guest_name gesetzt', 'can',
  'with c as (insert into public.comments (task_id, planner_id, author_user_id, body) values (''e0000000-0000-4000-8000-000000000001'', ''c0000000-0000-4000-8000-000000000001'', ''a0000000-0000-4000-8000-000000000001'', ''Gefälscht'') returning author_user_id, guest_name) select 1 from c where author_user_id is null and guest_name = ''Gast Bearbeiten''');

-- Claim: nur fällige Erinnerungen mit Zugriff, nicht erledigt, mit Adresse
insert into public.task_reminders (task_id, user_id, remind_at) values
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000003', now() - interval '1 minute'),
  ('e0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000005', now() - interval '1 minute');
create temp table claim_result on commit drop as select * from public.claim_due_reminders(10);
insert into rls_results (actor, label, passed, detail)
select 'service', 'Claim: liefert nur den User mit Zugriff', count(*) = 1 and bool_and(user_id = 'a0000000-0000-4000-8000-000000000003'), 'rows=' || count(*) from claim_result;
insert into rls_results (actor, label, passed, detail)
select 'service', 'Claim: markiert auch die ohne Zugriff als erledigt', count(*) = 2, 'rows=' || count(*) from public.task_reminders where sent_at is not null;
insert into rls_results (actor, label, passed, detail)
select 'service', 'Claim: künftige Erinnerung bleibt offen', count(*) = 1, 'rows=' || count(*) from public.task_reminders where sent_at is null;
insert into rls_results (actor, label, passed, detail)
select 'service', 'Claim: zweiter Lauf versendet nichts doppelt', count(*) = 0, 'rows=' || count(*) from public.claim_due_reminders(10);
update public.task_reminders set remind_at = now() + interval '1 hour' where user_id = 'a0000000-0000-4000-8000-000000000003';
insert into rls_results (actor, label, passed, detail)
select 'service', 'Neuer Zeitpunkt macht die Erinnerung wieder scharf', count(*) = 1 and bool_and(sent_at is null), 'rows=' || count(*) from public.task_reminders where user_id = 'a0000000-0000-4000-8000-000000000003';

select actor, label, passed, detail from rls_results order by n;

rollback;
