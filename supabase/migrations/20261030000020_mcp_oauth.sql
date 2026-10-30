-- ys-planner: OAuth für den MCP-Zugang (Claude Code, Desktop, Chat). Nur der Server greift zu (Service-Role):
-- RLS ohne Policies. Codes und Tokens liegen nur als SHA-256-Hash vor.

create table public.mcp_clients (
  client_id text primary key,
  client_name text not null check (length(client_name) between 1 and 100),
  redirect_uris text[] not null check (cardinality(redirect_uris) between 1 and 10),
  created_at timestamptz not null default now()
);

create table public.mcp_auth_codes (
  code_hash text primary key,
  client_id text not null references public.mcp_clients (client_id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  redirect_uri text not null,
  code_challenge text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index mcp_auth_codes_expiry_idx on public.mcp_auth_codes (expires_at);

create table public.mcp_tokens (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.mcp_clients (client_id) on delete cascade,
  user_id uuid not null references public.users (id) on delete cascade,
  access_hash text not null unique,
  access_expires_at timestamptz not null,
  refresh_hash text not null unique,
  refresh_expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index mcp_tokens_user_idx on public.mcp_tokens (user_id);
create index mcp_tokens_client_idx on public.mcp_tokens (client_id);

alter table public.mcp_clients enable row level security;
alter table public.mcp_auth_codes enable row level security;
alter table public.mcp_tokens enable row level security;
revoke all on public.mcp_clients, public.mcp_auth_codes, public.mcp_tokens from anon, authenticated;
