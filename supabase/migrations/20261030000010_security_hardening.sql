-- ys-planner: Security-Härtung
-- 1. User sehen nur Personen, mit denen sie einen Planner/Ordner teilen; Fremde nur per exakter E-Mail
-- 2. notify_email nur Login-Mail oder bestätigte Absender-Adresse
-- 3. Tageslimit für Bestätigungsmails

-- ---------------------------------------------------------------------------
-- Sichtbarkeit von Usern
-- ---------------------------------------------------------------------------
create or replace function app.shares_with_me(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select u = app.uid()
    or exists (
      select 1 from public.planner_members a
        join public.planner_members b on b.planner_id = a.planner_id
       where a.user_id = app.uid() and b.user_id = u)
    or exists (
      select 1 from public.folder_members a
        join public.folder_members b on b.folder_id = a.folder_id
       where a.user_id = app.uid() and b.user_id = u)
    or exists (
      select 1 from public.planner_members a
        join public.planners p on p.id = a.planner_id
        join public.folder_members b on b.folder_id = p.folder_id
       where a.user_id = app.uid() and b.user_id = u)
    or exists (
      select 1 from public.folder_members a
        join public.planners p on p.folder_id = a.folder_id
        join public.planner_members b on b.planner_id = p.id
       where a.user_id = app.uid() and b.user_id = u)
$$;

alter policy users_select on public.users
  using (case when app.is_guest() then app.guest_can_see_user(id) else app.shares_with_me(id) end);

-- Zitadel-ID bleibt serverseitig; geschrieben wird nur per Service-Role
revoke all on public.users from anon, authenticated;
grant select (id, email, display_name, avatar_color) on public.users to authenticated;

-- Einladen: bekannte Personen per Teilstring, alle anderen nur per vollständiger E-Mail
create or replace function public.search_users(q text)
returns table (id uuid, email text, display_name text, avatar_color text)
language sql stable security definer set search_path = '' as $$
  select u.id, u.email, u.display_name, u.avatar_color
    from public.users u
   where app.uid() is not null
     and length(trim(q)) >= 2
     and (
       lower(u.email) = lower(trim(q))
       or (app.shares_with_me(u.id)
           and (strpos(lower(u.display_name), lower(trim(q))) > 0 or strpos(lower(u.email), lower(trim(q))) > 0))
     )
   order by u.display_name
   limit 8
$$;
revoke execute on function public.search_users(text) from public, anon;
grant execute on function public.search_users(text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- notify_email: keine Benachrichtigungen an fremde Adressen
-- ---------------------------------------------------------------------------
create or replace function app.tg_user_settings_notify_email() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.notify_email := nullif(lower(trim(new.notify_email)), '');
  if auth.uid() is null or new.notify_email is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.notify_email is not distinct from lower(old.notify_email) then
    return new;
  end if;
  if not exists (select 1 from public.users u where u.id = new.user_id and lower(u.email) = new.notify_email)
     and not exists (
       select 1 from public.user_sender_emails s
        where s.user_id = new.user_id and s.email = new.notify_email and s.confirmed_at is not null) then
    raise exception 'notify_email_not_confirmed' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger user_settings_notify_email before insert or update on public.user_settings
  for each row execute function app.tg_user_settings_notify_email();

-- ---------------------------------------------------------------------------
-- Tageslimit für Bestätigungsmails (nur Service-Role)
-- ---------------------------------------------------------------------------
create table public.mail_rate_limits (
  user_id uuid primary key references public.users (id) on delete cascade,
  window_start timestamptz not null default now(),
  sent integer not null default 0
);
alter table public.mail_rate_limits enable row level security;
revoke all on public.mail_rate_limits from anon, authenticated;

-- Zählt einen Versand; true, solange das Tageslimit nicht überschritten ist
create or replace function public.mail_rate_hit(u uuid, max_per_day integer) returns boolean
language sql security definer set search_path = '' as $$
  insert into public.mail_rate_limits as m (user_id, window_start, sent)
  values (u, now(), 1)
  on conflict (user_id) do update set
    window_start = case when m.window_start < now() - interval '1 day' then now() else m.window_start end,
    sent = case when m.window_start < now() - interval '1 day' then 1 else m.sent + 1 end
  returning sent <= max_per_day
$$;
revoke execute on function public.mail_rate_hit(uuid, integer) from public, anon, authenticated;
grant execute on function public.mail_rate_hit(uuid, integer) to service_role;

revoke execute on all functions in schema app from public, anon;
grant execute on all functions in schema app to authenticated, service_role;
