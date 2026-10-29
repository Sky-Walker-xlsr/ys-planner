-- RLS-Tests für Planner.
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

-- Share-Links: read, edit, widerrufen, abgelaufen
insert into public.share_links (id, planner_id, token_hash, token_ciphertext, permission, revoked_at, expires_at, created_by) values
  ('90000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'h1', 'c1', 'read', null, null, 'a0000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'h2', 'c2', 'edit', null, now() + interval '1 day', 'a0000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000003', 'c0000000-0000-4000-8000-000000000001', 'h3', 'c3', 'edit', now(), null, 'a0000000-0000-4000-8000-000000000001'),
  ('90000000-0000-4000-8000-000000000004', 'c0000000-0000-4000-8000-000000000001', 'h4', 'c4', 'edit', null, now() - interval '1 hour', 'a0000000-0000-4000-8000-000000000001');

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
  KB constant text := '''c0000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000001.md''';

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
  sel_obj text := 'select 1 from storage.objects where bucket_id = ''knowledge-base'' and name = ' || KB;
  ins_obj2 text := 'insert into storage.objects (bucket_id, name) values (''knowledge-base'', ''c0000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000002.md'')';
  ins_obj_orphan text := 'insert into storage.objects (bucket_id, name) values (''knowledge-base'', ''c0000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-0000000000ff.md'')';
  ins_assignee_stranger text := 'insert into public.task_assignees (task_id, user_id, planner_id) values (' || T1 || ', ''a0000000-0000-4000-8000-000000000005'', ' || P || ')';
  ins_assignee_editor text := 'insert into public.task_assignees (task_id, user_id, planner_id) values (' || T1 || ', ''a0000000-0000-4000-8000-000000000002'', ' || P || ')';
  sel_users text := 'select id from public.users where email like ''%@test.local''';
begin
  -- Fixture für Storage-Lesetests
  insert into storage.objects (bucket_id, name) values ('knowledge-base', 'c0000000-0000-4000-8000-000000000001/f0000000-0000-4000-8000-000000000001.md');

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
  perform pg_temp.check('editor', editor, 'KB-Objekt hochladen', 'can', ins_obj2);
  perform pg_temp.check('editor', editor, 'KB-Objekt ohne kb_files-Zeile verboten', 'cannot', ins_obj_orphan);
  perform pg_temp.check('editor', editor, 'sich selbst zuweisen', 'can', ins_assignee_editor);
  perform pg_temp.check('editor', editor, 'Planner umbenennen verboten', 'cannot', upd_planner);
  perform pg_temp.check('editor', editor, 'Planner löschen verboten', 'cannot', del_planner);
  perform pg_temp.check('editor', editor, 'Mitglieder einladen verboten', 'cannot', ins_member);
  perform pg_temp.check('editor', editor, 'Share-Links unsichtbar', 'rows', sel_links, 0);
  perform pg_temp.check('editor', editor, 'Share-Link widerrufen verboten', 'cannot', revoke_link);

  -- Leser -------------------------------------------------------------------
  perform pg_temp.check('viewer', viewer, 'sieht Tasks von P', 'rows', 'select id from public.tasks where planner_id = ' || P, 1);
  perform pg_temp.check('viewer', viewer, 'sieht Kommentare', 'rows', 'select id from public.comments where planner_id = ' || P, 1);
  perform pg_temp.check('viewer', viewer, 'liest KB-Objekt', 'rows', sel_obj, 1);
  perform pg_temp.check('viewer', viewer, 'Task anlegen verboten', 'cannot', ins_task);
  perform pg_temp.check('viewer', viewer, 'Task ändern verboten', 'cannot', upd_task);
  perform pg_temp.check('viewer', viewer, 'Task löschen verboten', 'cannot', del_task);
  perform pg_temp.check('viewer', viewer, 'Kommentieren verboten', 'cannot', ins_comment);
  perform pg_temp.check('viewer', viewer, 'KB-Datei anlegen verboten', 'cannot', ins_kb);
  perform pg_temp.check('viewer', viewer, 'KB-Objekt hochladen verboten', 'cannot', ins_obj2);
  perform pg_temp.check('viewer', viewer, 'KB-Objekt schreiben verboten', 'cannot', 'update storage.objects set metadata = ''{}'' where bucket_id = ''knowledge-base'' and name = ' || KB);
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

  -- Fremder -----------------------------------------------------------------
  perform pg_temp.check('stranger', stranger, 'sieht keine fremden Planner', 'rows', 'select id from public.planners where id in (' || P || ',' || P2 || ')', 0);
  perform pg_temp.check('stranger', stranger, 'sieht keine Tasks', 'rows', 'select id from public.tasks where id in (' || T1 || ',' || T2 || ')', 0);
  perform pg_temp.check('stranger', stranger, 'sieht keinen Ordner', 'rows', 'select id from public.folders where id = ' || FO, 0);
  perform pg_temp.check('stranger', stranger, 'liest kein KB-Objekt', 'rows', sel_obj, 0);
  perform pg_temp.check('stranger', stranger, 'Task anlegen verboten', 'cannot', ins_task);
  perform pg_temp.check('stranger', stranger, 'Mitglied werden verboten', 'cannot', ins_member);
  perform pg_temp.check('stranger', stranger, 'eigenen Planner anlegen', 'can', ins_planner);
  perform pg_temp.check('stranger', stranger, 'eigenen Ordner anlegen', 'can', 'insert into public.folders (owner_id, name) values (''a0000000-0000-4000-8000-000000000005'', ''Mein Ordner'')');
  perform pg_temp.check('stranger', stranger, 'User-Suche möglich', 'rows', sel_users, 5);
  perform pg_temp.check('stranger', stranger, 'Planner in fremden Ordner verboten', 'cannot',
    'insert into public.planners (owner_id, folder_id, name) values (''a0000000-0000-4000-8000-000000000005'', ' || FO || ', ''X'')');

  -- Gast read ---------------------------------------------------------------
  perform pg_temp.check('guest-read', g_read, 'sieht P', 'rows', 'select id from public.planners where id = ' || P, 1);
  perform pg_temp.check('guest-read', g_read, 'sieht Tasks von P', 'rows', 'select id from public.tasks where planner_id = ' || P, 1);
  perform pg_temp.check('guest-read', g_read, 'sieht P2 nicht', 'rows', 'select id from public.tasks where id = ' || T2, 0);
  perform pg_temp.check('guest-read', g_read, 'liest KB-Objekt', 'rows', sel_obj, 1);
  perform pg_temp.check('guest-read', g_read, 'sieht nur Mitglieder (owner, editor, viewer, folder)', 'rows', sel_users, 4);
  perform pg_temp.check('guest-read', g_read, 'Task anlegen verboten', 'cannot', ins_task);
  perform pg_temp.check('guest-read', g_read, 'KB-Objekt hochladen verboten', 'cannot', ins_obj2);
  perform pg_temp.check('guest-read', g_read, 'Kommentieren verboten', 'cannot', ins_comment);
  perform pg_temp.check('guest-read', g_read, 'Share-Links unsichtbar', 'rows', sel_links, 0);
  perform pg_temp.check('guest-read', g_read, 'Ordner unsichtbar', 'rows', 'select id from public.folders', 0);
  perform pg_temp.check('guest-read', g_read, 'Planner anlegen verboten', 'cannot', ins_planner_guest);

  -- Gast edit ---------------------------------------------------------------
  perform pg_temp.check('guest-edit', g_edit, 'Rolle = editor', 'rows', 'select 1 where public.planner_role(' || P || ') = ''editor''', 1);
  perform pg_temp.check('guest-edit', g_edit, 'Task anlegen', 'can', ins_task);
  perform pg_temp.check('guest-edit', g_edit, 'Task ändern', 'can', upd_task);
  perform pg_temp.check('guest-edit', g_edit, 'Kommentieren (mit Gastname)', 'can', ins_comment);
  perform pg_temp.check('guest-edit', g_edit, 'Bucket anlegen', 'can', ins_bucket);
  perform pg_temp.check('guest-edit', g_edit, 'KB-Datei anlegen', 'can', ins_kb);
  perform pg_temp.check('guest-edit', g_edit, 'KB-Objekt hochladen', 'can', ins_obj2);
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

select actor, label, passed, detail from rls_results order by n;

rollback;
