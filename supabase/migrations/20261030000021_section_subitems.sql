-- ys-planner: Unterpunkte (eine Ebene unter den Punkten eines Abschnitts)
alter table public.section_items add column parent_id uuid references public.section_items (id) on delete cascade;
create index section_items_parent_idx on public.section_items (parent_id);

create or replace function app.tg_section_items_parent() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  parent record;
begin
  if new.parent_id is null then
    return new;
  end if;
  select section_id, parent_id into parent from public.section_items where id = new.parent_id;
  if not found or parent.section_id <> new.section_id then
    raise exception 'Übergeordneter Punkt gehört nicht zum Abschnitt' using errcode = '23514';
  end if;
  if parent.parent_id is not null
     or new.parent_id = new.id
     or exists (select 1 from public.section_items where parent_id = new.id) then
    raise exception 'Unterpunkte können keine eigenen Unterpunkte haben' using errcode = '23514';
  end if;
  return new;
end
$$;
create trigger section_items_parent before insert or update of parent_id, section_id on public.section_items
  for each row execute function app.tg_section_items_parent();

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
