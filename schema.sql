-- =====================================================================
-- MockAgent — Supabase / PostgreSQL schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- tools: virtual mock tool endpoints created by a user
-- ---------------------------------------------------------------------
create table if not exists public.tools (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  description      text,
  json_schema      jsonb not null default '{}'::jsonb,   -- expected_json_schema (JSON Schema draft-07)
  mock_response    jsonb not null default '{}'::jsonb,   -- mock_response_body returned on success
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint tools_name_not_blank check (char_length(trim(name)) > 0)
);

comment on table public.tools is 'User-defined mock tool endpoints for AI agent testing.';

create index if not exists tools_user_id_idx on public.tools (user_id);
create index if not exists tools_created_at_idx on public.tools (created_at desc);

-- keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tools_set_updated_at on public.tools;
create trigger tools_set_updated_at
  before update on public.tools
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- logs: every call made against the dynamic mock gateway
-- ---------------------------------------------------------------------
create table if not exists public.logs (
  id               uuid primary key default uuid_generate_v4(),
  tool_id          uuid not null references public.tools (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  payload          jsonb not null default '{}'::jsonb,     -- incoming tool-call arguments
  status           text not null check (status in ('SUCCESS', 'SCHEMA_VIOLATION')),
  error_details    jsonb,                                   -- ajv errors, null on success
  latency_ms       integer not null default 0,
  created_at       timestamptz not null default now()
);

comment on table public.logs is 'Execution trajectory / call log for the dynamic mock gateway.';

create index if not exists logs_user_id_idx on public.logs (user_id);
create index if not exists logs_tool_id_idx on public.logs (tool_id);
create index if not exists logs_created_at_idx on public.logs (created_at desc);
create index if not exists logs_status_idx on public.logs (status);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.tools enable row level security;
alter table public.logs  enable row level security;

-- tools: owners can fully manage their own rows
drop policy if exists "tools_select_own" on public.tools;
create policy "tools_select_own"
  on public.tools for select
  using (auth.uid() = user_id);

drop policy if exists "tools_insert_own" on public.tools;
create policy "tools_insert_own"
  on public.tools for insert
  with check (auth.uid() = user_id);

drop policy if exists "tools_update_own" on public.tools;
create policy "tools_update_own"
  on public.tools for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "tools_delete_own" on public.tools;
create policy "tools_delete_own"
  on public.tools for delete
  using (auth.uid() = user_id);

-- logs: owners can read their own rows. Gateway inserts use the service role.
-- NOTE: the gateway route (app/api/v1/mock/[toolId]/route.ts) writes logs using the
-- Supabase SERVICE ROLE key server-side, since the caller hitting the gateway is an
-- external AI agent, not an authenticated dashboard user. RLS still protects reads
-- so a user can only ever see logs tied to their own tools.
drop policy if exists "logs_select_own" on public.logs;
create policy "logs_select_own"
  on public.logs for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "logs_insert_own" on public.logs;

-- No update/delete policies on logs — execution history is append-only/immutable
-- from the dashboard's perspective. Deletes cascade only via tool deletion.

-- ---------------------------------------------------------------------
-- Convenience view: per-tool aggregate stats for the dashboard
-- ---------------------------------------------------------------------
create or replace view public.tool_stats as
select
  t.id            as tool_id,
  t.user_id,
  t.name,
  count(l.id)                                                   as total_calls,
  count(l.id) filter (where l.status = 'SCHEMA_VIOLATION')      as schema_violations,
  count(l.id) filter (where l.status = 'SUCCESS')               as successful_calls,
  max(l.created_at)                                             as last_called_at
from public.tools t
left join public.logs l on l.tool_id = t.id
group by t.id, t.user_id, t.name;

alter view public.tool_stats set (security_invoker = on);
