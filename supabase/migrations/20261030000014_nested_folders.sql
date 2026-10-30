-- ys-planner: Ordner in Ordnern. Freigaben gelten für den Ordner und alles darunter.
-- Wer nur einen Unterordner sieht, sieht den Elternordner nicht (auch nicht dessen Namen).

alter table public.folders add column parent_id uuid references public.folders (id) on delete set null;
create index folders_parent_idx on public.folders (parent_id);

-- ---------------------------------------------------------------------------
-- Baum (union statt union all: bricht auch bei einem Zyklus ab)
-- ---------------------------------------------------------------------------
create or replace function app.folder_ancestors(f uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive chain (id) as (
    select f where f is not null
    union
    select fo.parent_id
      from public.folders fo
      join chain on chain.id = fo.id
     where fo.parent_id is not null
  )
  select id from chain
$$;

create or replace function app.folder_descendants(f uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  with recursive tree (id) as (
    select f where f is not null
    union
    select fo.id
      from public.folders fo
      join tree on fo.parent_id = tree.id
  )
  select id from tree
$$;

-- ---------------------------------------------------------------------------
-- Rollen: höchste Rolle aus dem Ordner und allen Elternordnern
-- ---------------------------------------------------------------------------
create or replace function app.folder_role_of(f uuid, u uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select fm.role
    from public.folder_members fm
   where fm.user_id = u
     and fm.folder_id in (select app.folder_ancestors(f))
   order by app.role_rank(fm.role) desc
   limit 1
$$;

create or replace function public.folder_role(f uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select app.folder_role_of(f, app.uid())
$$;

create or replace function app.planner_role_of(p uuid, u uuid) returns public.member_role
language sql stable security definer set search_path = '' as $$
  select r from (
    select pm.role as r
      from public.planner_members pm
     where pm.planner_id = p and pm.user_id = u
    union all
    select app.folder_role_of(pl.folder_id, u)
      from public.planners pl
     where pl.id = p and pl.folder_id is not null
  ) x
  where r is not null
  order by app.role_rank(r) desc
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Sichtbarkeit: Mitglieder der Elternordner haben Zugriff auf dieselben Inhalte
-- ---------------------------------------------------------------------------
create or replace function app.can_see_folder_members(f uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from app.folder_descendants(f) d
     where app.can_see_folder(d) or app.guest_sees_folder(d)
  )
$$;

alter policy folder_members_select on public.folder_members
  using (app.can_see_folder_members(folder_id));

-- IDs von Ordner und Elternordnern für die Mitgliederliste (Namen bleiben über RLS geschützt)
create or replace function public.folder_chain(f uuid) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select id
    from app.folder_ancestors(f) id
   where app.can_see_folder(f) or app.guest_sees_folder(f)
$$;
revoke execute on function public.folder_chain(uuid) from public, anon;
grant execute on function public.folder_chain(uuid) to authenticated, service_role;

create or replace function app.shares_with_me(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u = app.uid()
    or exists (
      select 1 from public.planner_members a
        join public.planner_members b on b.planner_id = a.planner_id
       where a.user_id = app.uid() and b.user_id = u)
    or exists (
      select 1 from public.folder_members a
        join public.folder_members b on b.user_id = u
       where a.user_id = app.uid()
         and (a.folder_id in (select app.folder_ancestors(b.folder_id))
              or b.folder_id in (select app.folder_ancestors(a.folder_id))))
    or exists (
      select 1 from public.planner_members a
        join public.planners p on p.id = a.planner_id
        join public.folder_members b on b.user_id = u
       where a.user_id = app.uid()
         and b.folder_id in (select app.folder_ancestors(p.folder_id)))
    or exists (
      select 1 from public.folder_members a
        join public.planners p on p.folder_id in (select app.folder_descendants(a.folder_id))
        join public.planner_members b on b.planner_id = p.id
       where a.user_id = app.uid() and b.user_id = u)
$$;

-- ---------------------------------------------------------------------------
-- Verschieben: nur als Owner des Zielordners und nie in den eigenen Teilbaum
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

  if new.parent_id is not null and (tg_op = 'INSERT' or new.parent_id is distinct from old.parent_id) then
    if auth.uid() is not null and public.folder_role(new.parent_id) is distinct from 'owner' then
      raise exception 'Nur Owner des Zielordners dürfen Ordner hineinverschieben' using errcode = '42501';
    end if;
    -- Sperre: Zwei gleichzeitige Verschiebungen könnten sonst zusammen einen Zyklus bilden
    perform pg_advisory_xact_lock(727001);
    if new.id in (select app.folder_ancestors(new.parent_id)) then
      raise exception 'folder_cycle' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
