-- Planner: Row Level Security
-- Alle Policies bauen auf public.planner_role(planner_id) bzw. app.has_role() auf.

alter table public.users enable row level security;
alter table public.user_settings enable row level security;
alter table public.folders enable row level security;
alter table public.folder_members enable row level security;
alter table public.planners enable row level security;
alter table public.planner_members enable row level security;
alter table public.favorites enable row level security;
alter table public.buckets enable row level security;
alter table public.labels enable row level security;
alter table public.tasks enable row level security;
alter table public.task_assignees enable row level security;
alter table public.task_labels enable row level security;
alter table public.task_sections enable row level security;
alter table public.section_items enable row level security;
alter table public.comments enable row level security;
alter table public.kb_files enable row level security;
alter table public.task_attachments enable row level security;
alter table public.share_links enable row level security;
alter table public.activity_log enable row level security;

-- anon hat keinerlei Zugriff (Gäste kommen mit eigenem JWT als authenticated)
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- users: Eingeloggte sehen alle (Einladen per Suche), Gäste nur Planner-Mitglieder.
-- Schreiben nur serverseitig (Service-Role beim Login).
-- ---------------------------------------------------------------------------
create policy users_select on public.users for select to authenticated
  using (case when app.is_guest() then app.guest_can_see_user(id) else true end);

-- ---------------------------------------------------------------------------
-- user_settings: nur eigene Zeile
-- ---------------------------------------------------------------------------
create policy user_settings_select on public.user_settings for select to authenticated
  using (user_id = app.uid());
create policy user_settings_insert on public.user_settings for insert to authenticated
  with check (user_id = app.uid());
create policy user_settings_update on public.user_settings for update to authenticated
  using (user_id = app.uid()) with check (user_id = app.uid());

-- ---------------------------------------------------------------------------
-- folders / folder_members
-- ---------------------------------------------------------------------------
create policy folders_select on public.folders for select to authenticated
  using (app.can_see_folder(id));
create policy folders_insert on public.folders for insert to authenticated
  with check (app.uid() is not null and owner_id = app.uid());
create policy folders_update on public.folders for update to authenticated
  using (public.folder_role(id) = 'owner') with check (public.folder_role(id) = 'owner');
create policy folders_delete on public.folders for delete to authenticated
  using (public.folder_role(id) = 'owner');

create policy folder_members_select on public.folder_members for select to authenticated
  using (app.can_see_folder(folder_id));
create policy folder_members_insert on public.folder_members for insert to authenticated
  with check (public.folder_role(folder_id) = 'owner');
create policy folder_members_update on public.folder_members for update to authenticated
  using (public.folder_role(folder_id) = 'owner') with check (public.folder_role(folder_id) = 'owner');
create policy folder_members_delete on public.folder_members for delete to authenticated
  using (public.folder_role(folder_id) = 'owner');

-- ---------------------------------------------------------------------------
-- planners / planner_members
-- ---------------------------------------------------------------------------
create policy planners_select on public.planners for select to authenticated
  using (public.planner_role(id) is not null);
create policy planners_insert on public.planners for insert to authenticated
  with check (app.uid() is not null and owner_id = app.uid());
-- Ordnerwechsel wird zusätzlich im Trigger geprüft (Owner des Zielordners)
create policy planners_update on public.planners for update to authenticated
  using (public.planner_role(id) = 'owner') with check (true);
create policy planners_delete on public.planners for delete to authenticated
  using (public.planner_role(id) = 'owner');

create policy planner_members_select on public.planner_members for select to authenticated
  using (app.has_role(planner_id, 'viewer'));
create policy planner_members_insert on public.planner_members for insert to authenticated
  with check (not app.is_guest() and public.planner_role(planner_id) = 'owner');
create policy planner_members_update on public.planner_members for update to authenticated
  using (not app.is_guest() and public.planner_role(planner_id) = 'owner')
  with check (public.planner_role(planner_id) = 'owner');
create policy planner_members_delete on public.planner_members for delete to authenticated
  using (not app.is_guest() and public.planner_role(planner_id) = 'owner');

-- ---------------------------------------------------------------------------
-- favorites: eigene Zeilen für sichtbare Planner
-- ---------------------------------------------------------------------------
create policy favorites_select on public.favorites for select to authenticated
  using (user_id = app.uid());
create policy favorites_insert on public.favorites for insert to authenticated
  with check (user_id = app.uid() and app.has_role(planner_id, 'viewer'));
create policy favorites_update on public.favorites for update to authenticated
  using (user_id = app.uid()) with check (user_id = app.uid());
create policy favorites_delete on public.favorites for delete to authenticated
  using (user_id = app.uid());

-- ---------------------------------------------------------------------------
-- Planner-Inhalte: lesen ab viewer, schreiben ab editor
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'buckets', 'labels', 'tasks', 'task_assignees', 'task_labels',
    'task_sections', 'section_items', 'kb_files', 'task_attachments'
  ] loop
    execute format(
      'create policy %1$s_select on public.%1$I for select to authenticated using (app.has_role(planner_id, ''viewer''))', t);
    execute format(
      'create policy %1$s_insert on public.%1$I for insert to authenticated with check (app.has_role(planner_id, ''editor''))', t);
    execute format(
      'create policy %1$s_update on public.%1$I for update to authenticated using (app.has_role(planner_id, ''editor'')) with check (app.has_role(planner_id, ''editor''))', t);
    execute format(
      'create policy %1$s_delete on public.%1$I for delete to authenticated using (app.has_role(planner_id, ''editor''))', t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- comments: lesen ab viewer, schreiben ab editor, ändern/löschen nur eigene
-- ---------------------------------------------------------------------------
create policy comments_select on public.comments for select to authenticated
  using (app.has_role(planner_id, 'viewer'));
create policy comments_insert on public.comments for insert to authenticated
  with check (app.has_role(planner_id, 'editor'));
create policy comments_update on public.comments for update to authenticated
  using (
    app.has_role(planner_id, 'editor')
    and (author_user_id = app.uid() or (app.is_guest() and guest_id = auth.uid()))
  )
  with check (app.has_role(planner_id, 'editor'));
create policy comments_delete on public.comments for delete to authenticated
  using (
    app.has_role(planner_id, 'editor')
    and (author_user_id = app.uid() or (app.is_guest() and guest_id = auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- share_links: nur Owner (nie Gäste)
-- ---------------------------------------------------------------------------
create policy share_links_select on public.share_links for select to authenticated
  using (not app.is_guest() and public.planner_role(planner_id) = 'owner');
create policy share_links_insert on public.share_links for insert to authenticated
  with check (not app.is_guest() and public.planner_role(planner_id) = 'owner' and created_by = app.uid());
create policy share_links_update on public.share_links for update to authenticated
  using (not app.is_guest() and public.planner_role(planner_id) = 'owner')
  with check (public.planner_role(planner_id) = 'owner');
create policy share_links_delete on public.share_links for delete to authenticated
  using (not app.is_guest() and public.planner_role(planner_id) = 'owner');

-- Hashes verlassen die DB nie in Richtung Client: nur unkritische Spalten lesbar.
-- Erstellen läuft serverseitig (Passwort-Hash, Token-Verschlüsselung).
revoke select, insert on public.share_links from authenticated;
grant select (id, planner_id, token_ciphertext, permission, require_name, expires_at, revoked_at, created_by, created_at)
  on public.share_links to authenticated;
revoke update on public.share_links from authenticated;
grant update (revoked_at) on public.share_links to authenticated;

-- ---------------------------------------------------------------------------
-- activity_log: lesen ab viewer, schreiben nur per Trigger
-- ---------------------------------------------------------------------------
create policy activity_log_select on public.activity_log for select to authenticated
  using (app.has_role(planner_id, 'viewer'));
revoke insert, update, delete on public.activity_log from authenticated;
