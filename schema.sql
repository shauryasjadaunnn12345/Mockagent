-- =====================================================================
-- MockAgent — Supabase / PostgreSQL schema
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- =====================================================================

create extension if not exists "uuid-ossp";

-- ---------------------------------------------------------------------
-- workspaces: shared ownership boundary for tools, logs, and API keys
-- ---------------------------------------------------------------------
create table if not exists public.workspaces (
  id               uuid primary key default uuid_generate_v4(),
  name             text not null,
  log_retention_days integer not null default 7 check (log_retention_days in (7, 30, 90)),
  plan             text not null default 'free' check (plan in ('free', 'solo', 'team')),
  subscription_status text not null default 'free',
  dodo_customer_id text unique,
  dodo_subscription_id text unique,
  dodo_environment text,
  current_period_end timestamptz,
  created_by       uuid not null references auth.users (id) on delete cascade,
  created_at       timestamptz not null default now()
);
alter table public.workspaces add column if not exists log_retention_days integer not null default 7;
alter table public.workspaces add column if not exists plan text not null default 'free';
alter table public.workspaces add column if not exists subscription_status text not null default 'free';
alter table public.workspaces add column if not exists dodo_customer_id text unique;
alter table public.workspaces add column if not exists dodo_subscription_id text unique;
alter table public.workspaces add column if not exists dodo_environment text;
alter table public.workspaces add column if not exists current_period_end timestamptz;

create table if not exists public.workspace_members (
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  role             text not null check (role in ('owner', 'admin', 'member')),
  joined_at        timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create or replace function public.enforce_workspace_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_count integer;
  allowed_seats integer;
  current_plan text;
  current_status text;
begin
  if auth.role() = 'service_role' then return new; end if;
  if new.role = 'owner' then
    if exists (
      select 1 from public.workspaces
      where id = new.workspace_id and created_by = new.user_id
    ) then
      return new;
    end if;
    raise exception 'Only the workspace creator can be its owner.';
  end if;
  if new.role <> 'member' then raise exception 'Only trusted actions can assign elevated workspace roles.'; end if;

  select plan, subscription_status into current_plan, current_status
  from public.workspaces where id = new.workspace_id for update;
  allowed_seats := case
    when current_plan = 'team' and current_status in ('active', 'past_due') then 10
    when current_plan = 'solo' and current_status in ('active', 'past_due') then 1
    else 1
  end;
  select count(*) into current_count from public.workspace_members where workspace_id = new.workspace_id;
  if current_count >= allowed_seats then raise exception 'Workspace seat limit reached.'; end if;
  return new;
end;
$$;

drop trigger if exists workspace_members_enforce_seat_limit on public.workspace_members;
create trigger workspace_members_enforce_seat_limit
  before insert on public.workspace_members
  for each row execute function public.enforce_workspace_seat_limit();

create index if not exists workspace_members_user_idx on public.workspace_members (user_id);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_manager(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and role in ('owner', 'admin')
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id and user_id = auth.uid() and role = 'owner'
  );
$$;

grant execute on function public.is_workspace_member(uuid) to authenticated;
grant execute on function public.is_workspace_manager(uuid) to authenticated;
grant execute on function public.is_workspace_owner(uuid) to authenticated;

create or replace function public.list_workspace_members(target_workspace_id uuid)
returns table(user_id uuid, email text, role text)
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select m.user_id, u.email, m.role
  from public.workspace_members m
  join auth.users u on u.id = m.user_id
  where m.workspace_id = target_workspace_id
    and public.is_workspace_member(target_workspace_id)
  order by m.joined_at;
$$;

revoke all on function public.list_workspace_members(uuid) from public, anon;
grant execute on function public.list_workspace_members(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- tools: virtual mock tool endpoints created by a user
-- ---------------------------------------------------------------------
create table if not exists public.tools (
  id               uuid primary key default uuid_generate_v4(),
  workspace_id     uuid references public.workspaces (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  description      text,
  json_schema      jsonb not null default '{}'::jsonb,   -- expected_json_schema (JSON Schema draft-07)
  mock_response    jsonb not null default '{}'::jsonb,   -- mock_response_body returned on success
  scenarios        jsonb not null default '[]'::jsonb,   -- ordered conditional mock responses
  final_answer_assertions jsonb not null default '[]'::jsonb,
  semantic_criteria text,
  require_api_key  boolean not null default false,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint tools_name_not_blank check (char_length(trim(name)) > 0)
);

comment on table public.tools is 'User-defined mock tool endpoints for AI agent testing.';

create index if not exists tools_user_id_idx on public.tools (user_id);
create index if not exists tools_created_at_idx on public.tools (created_at desc);

create or replace function public.enforce_workspace_tool_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_plan text;
  current_status text;
  allowed_tools integer;
  current_count integer;
begin
  select plan, subscription_status into current_plan, current_status
  from public.workspaces where id = new.workspace_id for update;
  allowed_tools := case
    when current_plan = 'team' and current_status in ('active', 'past_due') then 250
    when current_plan = 'solo' and current_status in ('active', 'past_due') then 25
    else 3
  end;
  select count(*) into current_count from public.tools where workspace_id = new.workspace_id;
  if current_count >= allowed_tools then raise exception 'Workspace tool limit reached.'; end if;
  return new;
end;
$$;

drop trigger if exists tools_enforce_workspace_limit on public.tools;
create trigger tools_enforce_workspace_limit
  before insert on public.tools
  for each row execute function public.enforce_workspace_tool_limit();

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
-- api_keys: hashed bearer credentials owned by a user
-- ---------------------------------------------------------------------
create table if not exists public.api_keys (
  id               uuid primary key default uuid_generate_v4(),
  workspace_id     uuid references public.workspaces (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  name             text not null,
  key_prefix       text not null unique,
  key_hash         text not null,
  monthly_limit    integer not null default 10000 check (monthly_limit > 0),
  created_at       timestamptz not null default now(),
  revoked_at       timestamptz
);

create index if not exists api_keys_user_id_idx on public.api_keys (user_id);
create index if not exists api_keys_prefix_idx on public.api_keys (key_prefix);

create or replace function public.enforce_workspace_api_key_limit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  current_plan text;
  current_status text;
  allowed_keys integer;
  allowed_calls integer;
  current_count integer;
begin
  select plan, subscription_status into current_plan, current_status
  from public.workspaces where id = new.workspace_id for update;
  if current_plan = 'team' and current_status in ('active', 'past_due') then
    allowed_keys := 50;
    allowed_calls := 100000;
  elsif current_plan = 'solo' and current_status in ('active', 'past_due') then
    allowed_keys := 10;
    allowed_calls := 20000;
  else
    allowed_keys := 2;
    allowed_calls := 1000;
  end if;
  select count(*) into current_count
  from public.api_keys where workspace_id = new.workspace_id and revoked_at is null;
  if current_count >= allowed_keys then raise exception 'Workspace API key limit reached.'; end if;
  if new.monthly_limit > allowed_calls then raise exception 'API key call limit exceeds workspace plan.'; end if;
  return new;
end;
$$;

drop trigger if exists api_keys_enforce_workspace_limit on public.api_keys;
create trigger api_keys_enforce_workspace_limit
  before insert on public.api_keys
  for each row execute function public.enforce_workspace_api_key_limit();

create table if not exists public.api_key_usage (
  api_key_id       uuid not null references public.api_keys (id) on delete cascade,
  usage_month      date not null,
  calls_used       integer not null default 0 check (calls_used >= 0),
  primary key (api_key_id, usage_month)
);
alter table public.api_key_usage enable row level security;

create table if not exists public.workspace_usage (
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  usage_month      date not null,
  calls_used       integer not null default 0 check (calls_used >= 0),
  primary key (workspace_id, usage_month)
);
alter table public.workspace_usage enable row level security;

create table if not exists public.dodo_webhook_events (
  webhook_id       text primary key,
  event_type       text not null,
  processed_at     timestamptz not null default now()
);
alter table public.dodo_webhook_events enable row level security;

create or replace function public.consume_gateway_call(
  target_workspace_id uuid,
  target_api_key_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  allowed_limit integer;
  key_limit integer;
  workspace_calls integer;
  key_calls integer;
  current_month date := date_trunc('month', timezone('UTC', now()))::date;
begin
  select case
    when plan = 'team' and subscription_status in ('active', 'past_due') then 100000
    when plan = 'solo' and subscription_status in ('active', 'past_due') then 20000
    else 1000
  end into allowed_limit
  from public.workspaces
  where id = target_workspace_id;

  if allowed_limit is null then
    return -1;
  end if;

  insert into public.workspace_usage (workspace_id, usage_month, calls_used)
  values (target_workspace_id, current_month, 0)
  on conflict do nothing;
  select calls_used into workspace_calls
  from public.workspace_usage
  where workspace_id = target_workspace_id and usage_month = current_month
  for update;

  if target_api_key_id is not null then
    select monthly_limit into key_limit
    from public.api_keys
    where id = target_api_key_id
      and workspace_id = target_workspace_id
      and revoked_at is null;
    if key_limit is null then return -1; end if;

    insert into public.api_key_usage (api_key_id, usage_month, calls_used)
    values (target_api_key_id, current_month, 0)
    on conflict do nothing;
    select calls_used into key_calls
    from public.api_key_usage
    where api_key_id = target_api_key_id and usage_month = current_month
    for update;

    if workspace_calls >= allowed_limit or key_calls >= key_limit then
      return -1;
    end if;
    update public.api_key_usage
    set calls_used = calls_used + 1
    where api_key_id = target_api_key_id and usage_month = current_month;
  elsif workspace_calls >= allowed_limit then
    return -1;
  end if;

  update public.workspace_usage
  set calls_used = calls_used + 1
  where workspace_id = target_workspace_id and usage_month = current_month;

  return workspace_calls + 1;
end;
$$;

revoke all on function public.consume_gateway_call(uuid, uuid) from public, anon, authenticated;
grant execute on function public.consume_gateway_call(uuid, uuid) to service_role;
drop function if exists public.consume_api_key_call(uuid);

-- ---------------------------------------------------------------------
-- logs: every call made against the dynamic mock gateway
-- ---------------------------------------------------------------------
create table if not exists public.logs (
  id               uuid primary key default uuid_generate_v4(),
  workspace_id     uuid references public.workspaces (id) on delete cascade,
  tool_id          uuid not null references public.tools (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  payload          jsonb not null default '{}'::jsonb,     -- incoming tool-call arguments
  response_body   jsonb,                                   -- returned mock response for replay comparisons
  api_key_id       uuid references public.api_keys (id) on delete set null,
  status           text not null check (status in ('SUCCESS', 'SCHEMA_VIOLATION')),
  scenario_name    text,
  scenario_index   integer,
  scenario_step    integer,
  run_id           text,
  failure_fingerprint text,
  error_details    jsonb,                                   -- ajv errors, null on success
  latency_ms       integer not null default 0,
  created_at       timestamptz not null default now()
);

create table if not exists public.final_answer_submissions (
  id               uuid primary key default uuid_generate_v4(),
  workspace_id     uuid not null references public.workspaces (id) on delete cascade,
  tool_id          uuid not null references public.tools (id) on delete cascade,
  user_id          uuid not null references auth.users (id) on delete cascade,
  api_key_id       uuid references public.api_keys (id) on delete set null,
  run_id           text not null check (char_length(run_id) between 1 and 128),
  final_answer     text not null check (char_length(final_answer) between 1 and 30000),
  passed           boolean not null,
  assertion_results jsonb not null default '[]'::jsonb,
  semantic_status  text not null default 'not_configured'
    check (semantic_status in ('not_configured', 'passed', 'failed', 'error')),
  semantic_result  jsonb,
  created_at       timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'final_answer_submissions'
    ) then
    alter publication supabase_realtime add table public.final_answer_submissions;
  end if;
end;
$$;

create table if not exists public.user_settings (
  user_id          uuid primary key references auth.users (id) on delete cascade,
  current_workspace_id uuid references public.workspaces (id) on delete set null,
  log_retention_days integer not null default 7 check (log_retention_days in (7, 30, 90)),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table public.tools add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.logs add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.api_keys add column if not exists workspace_id uuid references public.workspaces (id) on delete cascade;
alter table public.user_settings add column if not exists current_workspace_id uuid references public.workspaces (id) on delete set null;

insert into public.workspaces (name, created_by)
select coalesce(nullif(trim(u.raw_user_meta_data->>'name'), ''), nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Personal') || ' workspace', u.id
from auth.users u
where not exists (
  select 1 from public.workspace_members m where m.user_id = u.id
);

insert into public.workspace_members (workspace_id, user_id, role)
select id, created_by, 'owner' from public.workspaces w
where not exists (
  select 1 from public.workspace_members m where m.workspace_id = w.id and m.user_id = w.created_by
);

update public.tools t
set workspace_id = m.workspace_id
from public.workspace_members m
where t.workspace_id is null and m.user_id = t.user_id and m.role = 'owner';

update public.logs l
set workspace_id = t.workspace_id
from public.tools t
where l.workspace_id is null and l.tool_id = t.id;

update public.api_keys k
set workspace_id = m.workspace_id
from public.workspace_members m
where k.workspace_id is null and m.user_id = k.user_id and m.role = 'owner';

insert into public.user_settings (user_id)
select id from auth.users
on conflict (user_id) do nothing;

update public.user_settings s
set current_workspace_id = m.workspace_id
from public.workspace_members m
where s.current_workspace_id is null and s.user_id = m.user_id;

create or replace function public.initialize_user_workspace()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  new_workspace_id uuid;
begin
  insert into public.workspaces (name, created_by)
  values (coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Personal') || ' workspace', new.id)
  returning id into new_workspace_id;
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new_workspace_id, new.id, 'owner');
  insert into public.user_settings (user_id, current_workspace_id)
  values (new.id, new_workspace_id)
  on conflict (user_id) do update set current_workspace_id = excluded.current_workspace_id;
  return new;
end;
$$;

drop trigger if exists auth_user_settings_created on auth.users;
drop trigger if exists auth_user_workspace_created on auth.users;
create trigger auth_user_workspace_created
  after insert on auth.users
  for each row execute function public.initialize_user_workspace();

alter table public.tools alter column workspace_id set not null;
alter table public.logs alter column workspace_id set not null;
alter table public.api_keys alter column workspace_id set not null;

create or replace function public.create_user_settings()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.user_settings (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists auth_user_settings_created on auth.users;
create trigger auth_user_settings_created
  after insert on auth.users
  for each row execute function public.create_user_settings();

create or replace function public.delete_expired_logs()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  deleted_count integer;
begin
  with deleted_logs as (
    delete from public.logs l
    using public.workspaces w
    where l.workspace_id = w.id
      and l.created_at < now() - make_interval(days => least(
        w.log_retention_days,
        case
          when w.plan = 'team' and w.subscription_status in ('active', 'past_due') then 90
          when w.plan = 'solo' and w.subscription_status in ('active', 'past_due') then 30
          else 7
        end
      ))
    returning l.id
    ), deleted_answers as (
      delete from public.final_answer_submissions s
      using public.workspaces w
      where s.workspace_id = w.id
        and s.created_at < now() - make_interval(days => least(
          w.log_retention_days,
          case
            when w.plan = 'team' and w.subscription_status in ('active', 'past_due') then 90
            when w.plan = 'solo' and w.subscription_status in ('active', 'past_due') then 30
            else 7
          end
        ))
      returning s.id
  )
    select (select count(*) from deleted_logs) + (select count(*) from deleted_answers)
    into deleted_count;
  return deleted_count;
end;
$$;

revoke all on function public.delete_expired_logs() from public, anon, authenticated;
grant execute on function public.delete_expired_logs() to service_role;

-- Additive upgrade for projects created before scenarios were introduced.
alter table public.tools
  add column if not exists scenarios jsonb not null default '[]'::jsonb,
  add column if not exists final_answer_assertions jsonb not null default '[]'::jsonb,
  add column if not exists semantic_criteria text,
  add column if not exists require_api_key boolean not null default false;
alter table public.final_answer_submissions
  add column if not exists semantic_status text not null default 'not_configured'
    check (semantic_status in ('not_configured', 'passed', 'failed', 'error')),
  add column if not exists semantic_result jsonb;
alter table public.logs
  add column if not exists scenario_name text,
  add column if not exists response_body jsonb,
  add column if not exists api_key_id uuid references public.api_keys (id) on delete set null,
  add column if not exists scenario_index integer,
  add column if not exists scenario_step integer,
  add column if not exists run_id text,
  add column if not exists failure_fingerprint text;

comment on table public.logs is 'Execution trajectory / call log for the dynamic mock gateway.';

create index if not exists logs_user_id_idx on public.logs (user_id);
create index if not exists logs_tool_id_idx on public.logs (tool_id);
create index if not exists logs_created_at_idx on public.logs (created_at desc);
create index if not exists logs_status_idx on public.logs (status);
create index if not exists logs_scenario_sequence_idx
  on public.logs (tool_id, run_id, scenario_index, status)
  where run_id is not null;
create index if not exists logs_failure_fingerprint_idx
  on public.logs (tool_id, run_id, failure_fingerprint)
  where run_id is not null and failure_fingerprint is not null;
create index if not exists final_answer_submissions_workspace_created_idx
  on public.final_answer_submissions (workspace_id, created_at desc);
create index if not exists final_answer_submissions_tool_run_idx
  on public.final_answer_submissions (tool_id, run_id, created_at desc);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.tools enable row level security;
alter table public.logs  enable row level security;
alter table public.final_answer_submissions enable row level security;
alter table public.api_keys enable row level security;
alter table public.user_settings enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;

drop policy if exists "workspaces_select_member" on public.workspaces;
create policy "workspaces_select_member" on public.workspaces
  for select to authenticated using (public.is_workspace_member(id));

drop policy if exists "workspaces_update_manager" on public.workspaces;
create policy "workspaces_update_manager" on public.workspaces
  for update to authenticated using (public.is_workspace_manager(id))
  with check (public.is_workspace_manager(id));

drop policy if exists "workspace_members_select_member" on public.workspace_members;
create policy "workspace_members_select_member" on public.workspace_members
  for select to authenticated using (public.is_workspace_member(workspace_id));

drop policy if exists "workspace_members_insert_manager" on public.workspace_members;
create policy "workspace_members_insert_manager" on public.workspace_members
  for insert to authenticated
  with check (
    public.is_workspace_manager(workspace_id)
    and role = 'member'
  );

drop policy if exists "workspace_members_delete_manager" on public.workspace_members;
create policy "workspace_members_delete_manager" on public.workspace_members
  for delete to authenticated
  using (
    public.is_workspace_manager(workspace_id)
    and role <> 'owner'
    and (role <> 'admin' or public.is_workspace_owner(workspace_id))
  );

drop policy if exists "user_settings_select_own" on public.user_settings;
create policy "user_settings_select_own"
  on public.user_settings for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_settings_insert_own" on public.user_settings;
create policy "user_settings_insert_own"
  on public.user_settings for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_settings_update_own" on public.user_settings;
create policy "user_settings_update_own"
  on public.user_settings for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "api_keys_select_own" on public.api_keys;
drop policy if exists "api_keys_select_workspace" on public.api_keys;
create policy "api_keys_select_workspace"
  on public.api_keys for select
  to authenticated
  using (public.is_workspace_manager(workspace_id));

drop policy if exists "api_keys_insert_own" on public.api_keys;
drop policy if exists "api_keys_insert_workspace" on public.api_keys;
drop policy if exists "api_keys_insert_workspace" on public.api_keys;

drop policy if exists "api_keys_update_own" on public.api_keys;
drop policy if exists "api_keys_update_workspace" on public.api_keys;
create policy "api_keys_update_workspace"
  on public.api_keys for update
  to authenticated
  using (public.is_workspace_manager(workspace_id))
  with check (public.is_workspace_manager(workspace_id));

-- tools: owners can fully manage their own rows
drop policy if exists "tools_select_own" on public.tools;
create policy "tools_select_own"
  on public.tools for select
  using (public.is_workspace_member(workspace_id));

drop policy if exists "tools_insert_own" on public.tools;
drop policy if exists "tools_insert_own" on public.tools;

drop policy if exists "tools_update_own" on public.tools;
create policy "tools_update_own"
  on public.tools for update
  using (public.is_workspace_member(workspace_id))
  with check (public.is_workspace_member(workspace_id));

drop policy if exists "tools_delete_own" on public.tools;
create policy "tools_delete_own"
  on public.tools for delete
  using (public.is_workspace_member(workspace_id));

-- logs: owners can read their own rows. Gateway inserts use the service role.
-- NOTE: the gateway route (app/api/v1/mock/[toolId]/route.ts) writes logs using the
-- Supabase SERVICE ROLE key server-side, since the caller hitting the gateway is an
-- external AI agent, not an authenticated dashboard user. RLS still protects reads
-- so a user can only ever see logs tied to their own tools.
drop policy if exists "logs_select_own" on public.logs;
create policy "logs_select_own"
  on public.logs for select
  to authenticated
  using (public.is_workspace_member(workspace_id));

drop policy if exists "logs_insert_own" on public.logs;

drop policy if exists "final_answer_submissions_select_workspace" on public.final_answer_submissions;
create policy "final_answer_submissions_select_workspace"
  on public.final_answer_submissions for select
  to authenticated
  using (public.is_workspace_member(workspace_id));
revoke insert, update, delete on public.final_answer_submissions from authenticated;

revoke insert on public.tools from authenticated;
revoke insert on public.api_keys from authenticated;
revoke update on public.api_keys from authenticated;
grant update (revoked_at) on public.api_keys to authenticated;
revoke update on public.workspaces from authenticated;
grant update (name, log_retention_days) on public.workspaces to authenticated;

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
  max(l.created_at)                                             as last_called_at,
  t.workspace_id
from public.tools t
left join public.logs l on l.tool_id = t.id
group by t.id, t.user_id, t.name;

alter view public.tool_stats set (security_invoker = on);

create or replace view public.daily_usage as
select
  user_id,
  date_trunc('day', created_at)::date as day,
  count(*)::integer as total_calls,
  count(*) filter (where status = 'SUCCESS')::integer as successful_calls,
  count(*) filter (where status = 'SCHEMA_VIOLATION')::integer as schema_violations,
  round(avg(latency_ms))::integer as average_latency_ms,
  workspace_id
from public.logs
group by user_id, date_trunc('day', created_at)::date, workspace_id;

alter view public.daily_usage set (security_invoker = on);
