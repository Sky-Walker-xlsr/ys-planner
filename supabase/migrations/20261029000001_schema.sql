-- ys-planner: Grundschema (Tabellen, Enums, Indizes, Basis-Trigger)

create schema if not exists app;
grant usage on schema app to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.member_role as enum ('owner', 'editor', 'viewer');
create type public.task_status as enum ('not_started', 'in_progress', 'done');
create type public.task_priority as enum ('urgent', 'important', 'medium', 'low');
create type public.share_permission as enum ('read', 'edit');
create type public.theme_mode as enum ('light', 'dark');

-- ---------------------------------------------------------------------------
-- Benutzer
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  zitadel_sub text not null unique,
  email text not null,
  display_name text not null,
  avatar_color text not null default '#1F7A57',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index users_email_idx on public.users (lower(email));
create index users_name_idx on public.users (lower(display_name));

create table public.user_settings (
  user_id uuid primary key references public.users (id) on delete cascade,
  theme public.theme_mode not null default 'light',
  notify_enabled boolean not null default true,
  notify_email text,
  notify_on_assign boolean not null default true,
  notify_on_due boolean not null default true,
  notify_on_mention boolean not null default true,
  notify_on_invite boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Ordner & Planner
-- ---------------------------------------------------------------------------
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  position double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index folders_owner_idx on public.folders (owner_id);

create table public.folder_members (
  folder_id uuid not null references public.folders (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (folder_id, user_id)
);
create index folder_members_user_idx on public.folder_members (user_id);

create table public.planners (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.users (id) on delete cascade,
  folder_id uuid references public.folders (id) on delete set null,
  name text not null check (length(trim(name)) between 1 and 120),
  color text not null default '#1F7A57',
  position double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index planners_owner_idx on public.planners (owner_id);
create index planners_folder_idx on public.planners (folder_id);

create table public.planner_members (
  planner_id uuid not null references public.planners (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  role public.member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (planner_id, user_id)
);
create index planner_members_user_idx on public.planner_members (user_id);

create table public.favorites (
  user_id uuid not null references public.users (id) on delete cascade,
  planner_id uuid not null references public.planners (id) on delete cascade,
  position double precision,
  created_at timestamptz not null default now(),
  primary key (user_id, planner_id)
);
create index favorites_planner_idx on public.favorites (planner_id);

-- ---------------------------------------------------------------------------
-- Board-Inhalte
-- ---------------------------------------------------------------------------
create table public.buckets (
  id uuid primary key default gen_random_uuid(),
  planner_id uuid not null references public.planners (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  position double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index buckets_planner_idx on public.buckets (planner_id, position);

create table public.labels (
  id uuid primary key default gen_random_uuid(),
  planner_id uuid not null references public.planners (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 60),
  color text not null check (color in ('blue', 'violet', 'orange', 'pink', 'teal', 'yellow')),
  created_at timestamptz not null default now()
);
create index labels_planner_idx on public.labels (planner_id);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  planner_id uuid not null references public.planners (id) on delete cascade,
  bucket_id uuid not null references public.buckets (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 300),
  description text not null default '',
  status public.task_status not null default 'not_started',
  priority public.task_priority not null default 'medium',
  start_date date,
  due_date date,
  position double precision,
  created_by uuid references public.users (id) on delete set null,
  created_by_guest text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tasks_planner_idx on public.tasks (planner_id);
create index tasks_bucket_idx on public.tasks (bucket_id, position);
create index tasks_due_idx on public.tasks (due_date) where status <> 'done';

create table public.task_assignees (
  task_id uuid not null references public.tasks (id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  planner_id uuid not null references public.planners (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index task_assignees_user_idx on public.task_assignees (user_id);
create index task_assignees_planner_idx on public.task_assignees (planner_id);

create table public.task_labels (
  task_id uuid not null references public.tasks (id) on delete cascade,
  label_id uuid not null references public.labels (id) on delete cascade,
  planner_id uuid not null references public.planners (id) on delete cascade,
  primary key (task_id, label_id)
);
create index task_labels_label_idx on public.task_labels (label_id);
create index task_labels_planner_idx on public.task_labels (planner_id);

create table public.task_sections (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  planner_id uuid not null references public.planners (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 200),
  due_date date,
  position double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index task_sections_task_idx on public.task_sections (task_id, position);
create index task_sections_planner_idx on public.task_sections (planner_id);
create index task_sections_due_idx on public.task_sections (due_date);

create table public.section_items (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.task_sections (id) on delete cascade,
  planner_id uuid not null references public.planners (id) on delete cascade,
  title text not null check (length(trim(title)) between 1 and 300),
  done boolean not null default false,
  position double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index section_items_section_idx on public.section_items (section_id, position);
create index section_items_planner_idx on public.section_items (planner_id);

create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  planner_id uuid not null references public.planners (id) on delete cascade,
  author_user_id uuid references public.users (id) on delete set null,
  guest_id uuid,
  guest_name text,
  body text not null check (length(trim(body)) between 1 and 10000),
  mentions uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (author_user_id is not null or guest_id is not null)
);
create index comments_task_idx on public.comments (task_id, created_at);
create index comments_planner_idx on public.comments (planner_id);

-- ---------------------------------------------------------------------------
-- Knowledge Base
-- ---------------------------------------------------------------------------
create table public.kb_files (
  id uuid primary key default gen_random_uuid(),
  planner_id uuid not null references public.planners (id) on delete cascade,
  name text not null check (name ~* '^[^/\\]{1,200}\.md$'),
  storage_path text not null unique,
  updated_by uuid references public.users (id) on delete set null,
  updated_by_guest text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (storage_path = planner_id::text || '/' || id::text || '.md')
);
create index kb_files_planner_idx on public.kb_files (planner_id);

create table public.task_attachments (
  task_id uuid not null references public.tasks (id) on delete cascade,
  kb_file_id uuid not null references public.kb_files (id) on delete cascade,
  planner_id uuid not null references public.planners (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, kb_file_id)
);
create index task_attachments_file_idx on public.task_attachments (kb_file_id);
create index task_attachments_planner_idx on public.task_attachments (planner_id);

-- ---------------------------------------------------------------------------
-- Share-Links
-- token_hash: SHA-256 des Tokens (Lookup). token_ciphertext: AES-GCM-verschlüsseltes
-- Token (Schlüssel nur im Server), damit Owner den Link später erneut kopieren können.
-- ---------------------------------------------------------------------------
create table public.share_links (
  id uuid primary key default gen_random_uuid(),
  planner_id uuid not null references public.planners (id) on delete cascade,
  token_hash text not null unique,
  token_ciphertext text not null,
  permission public.share_permission not null default 'read',
  require_name boolean not null default false,
  password_hash text,
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid references public.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index share_links_planner_idx on public.share_links (planner_id);

-- ---------------------------------------------------------------------------
-- Aktivitätsprotokoll
-- ---------------------------------------------------------------------------
create table public.activity_log (
  id bigint generated always as identity primary key,
  planner_id uuid not null references public.planners (id) on delete cascade,
  task_id uuid references public.tasks (id) on delete set null,
  actor uuid,
  actor_name text,
  action text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index activity_log_planner_idx on public.activity_log (planner_id, created_at desc);
