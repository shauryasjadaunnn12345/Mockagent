import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const schema = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");

function functionDefinition(name) {
  const start = schema.indexOf(`create or replace function public.${name}(`);
  assert.notEqual(start, -1, `${name} must be present in schema.sql`);
  const end = schema.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `${name} must have a complete function body`);
  return schema.slice(start, end + 4);
}

test("database AI and gateway quota caps match the plan entitlements", () => {
  const aiQuota = functionDefinition("consume_ai_request");
  const gatewayQuota = functionDefinition("consume_gateway_call");

  for (const [plan, aiRequests, calls] of [
    ["team", 5000, 100000],
    ["solo", 1000, 20000],
  ]) {
    assert.match(
      aiQuota,
      new RegExp(`when plan = '${plan}' and subscription_status in \\('active', 'past_due'\\) then ${aiRequests}`)
    );
    assert.match(
      gatewayQuota,
      new RegExp(`when plan = '${plan}' and subscription_status in \\('active', 'past_due'\\) then ${calls}`)
    );
  }
  assert.match(aiQuota, /else 100\s+end into allowed_limit/);
  assert.match(gatewayQuota, /else 1000\s+end into allowed_limit/);
});

test("quota RPCs lock monthly workspace counters and reject the boundary before incrementing", () => {
  for (const [name, counter, table, column] of [
    ["consume_ai_request", "request_count", "ai_workspace_usage", "requests_used"],
    ["consume_gateway_call", "workspace_calls", "workspace_usage", "calls_used"],
  ]) {
    const definition = functionDefinition(name);
    assert.match(definition, /security definer/);
    assert.match(definition, /set search_path = pg_catalog, public/);
    assert.match(definition, new RegExp(`from public\\.${table}[\\s\\S]*?for update`));
    assert.ok(
      definition.indexOf(`${counter} >= allowed_limit`) < definition.indexOf(`set ${column} = ${column} + 1`),
      `${name} must reject at the limit before incrementing`
    );
    assert.match(definition, /usage_month = current_month/);
  }
});

test("AI usage data and quota execution are restricted to trusted server code", () => {
  assert.match(schema, /alter table public\.ai_workspace_usage enable row level security;/);
  assert.match(
    schema,
    /revoke all on function public\.consume_ai_request\(uuid\) from public, anon, authenticated;\s+grant execute on function public\.consume_ai_request\(uuid\) to service_role;/
  );
});

test("workspace visibility policies derive access from the authenticated membership", () => {
  const membershipCheck = functionDefinition("is_workspace_member");
  assert.match(membershipCheck, /workspace_id = target_workspace_id and user_id = auth\.uid\(\)/);
  assert.match(
    schema,
    /create policy "logs_select_own"[\s\S]*?using \(public\.is_workspace_member\(workspace_id\)\)/
  );
  assert.match(
    schema,
    /create policy "agent_test_runs_select_workspace"[\s\S]*?using \(public\.is_workspace_member\(workspace_id\)\)/
  );
});

test("saved regression cases migrate existing prompts and preserve case-level run identity", () => {
  assert.match(
    schema,
    /set test_cases = jsonb_build_array\(jsonb_build_object\('name', 'Case 1', 'prompt', prompt\)\)[\s\S]*?where test_cases is null or test_cases = '\[\]'::jsonb;/
  );
  assert.match(
    schema,
    /add constraint agent_test_suites_test_cases_limit[\s\S]*?jsonb_array_length\(test_cases\) between 1 and 20/
  );
  assert.match(schema, /test_case_index\s+integer not null default 0/);
  assert.match(schema, /test_case_name\s+text not null default 'Case 1'/);
});
