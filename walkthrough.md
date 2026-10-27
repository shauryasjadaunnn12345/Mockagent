# MockAgent: Pitch Deck and Project Walkthrough

This document is a combined product pitch, guided demo, and technical tour of
the MockAgent repository. It is written for someone presenting the product,
onboarding a developer, or trying to understand how the app works end to end.

## 1. The pitch in one minute

**MockAgent is a test bench for AI agent tools.** It gives each configured tool
a real HTTP endpoint, checks incoming arguments against JSON Schema, returns
controlled mock data, and records what happened. Developers can test valid and
invalid calls, branch into named scenarios, replay successful requests, and
check an agent's final answer and tool-call sequence before connecting real
services.

The central value proposition is simple:

> Test the tool calls your agent has not made yet, without depending on
> production services, real accounts, or a hand-built mock server.

MockAgent is not an agent framework and it does not choose tools for the
agent. The agent or test harness makes the calls; MockAgent supplies the
controlled tool endpoints and evidence needed to inspect the run.

## 2. Pitch deck: slide-by-slide story

### Slide 1 — The problem: agent tools fail at the boundary

An AI agent may reason well and still fail because it supplied malformed
arguments, chose the wrong tool, called tools in the wrong order, or relied on
stale or unexpected data. Connecting every development test to a live service
makes those cases slow, expensive, risky, and difficult to reproduce.

**Talk track:** "We need to test the behavior around a tool call, not just
whether the agent can produce a plausible answer."

### Slide 2 — The solution: a controllable tool test bench

MockAgent turns a tool definition into an HTTP endpoint. The developer defines
the accepted JSON arguments and the response to return. Calls are checked and
logged; named scenarios can substitute responses for particular inputs.

**Show:** Create a tool, copy its gateway URL, and call it with JSON.

### Slide 3 — The workflow: define, call, inspect

1. Describe a tool with a name, description, JSON Schema, default response,
   and optional scenarios.
2. Point an agent or test harness at the generated endpoint.
3. Inspect success, validation failures, response snapshots, latency,
   scenario selection, and run IDs in the workspace dashboard.

The landing page also has a small, browser-only interactive demo. It
demonstrates schema validation and scenario matching with sample data; it does
not call a live MockAgent endpoint.

### Slide 4 — Better feedback than a generic mock server

AJV validates tool-call arguments and reports all schema errors in one
response. When a run ID is provided, an identical repeated invalid call is
recognized so an agent can be told to correct the arguments rather than retry
the same failure. The gateway returns structured error classes, error codes,
retry guidance, and a stable failure fingerprint where applicable.

**Talk track:** "The test endpoint does not just say 'bad request'; it returns
actionable contract feedback."

### Slide 5 — Test the paths that are hard to reproduce

Ordered scenarios let a tool return different data for matching inputs. A
scenario can return one response or a response sequence, which is useful for
testing changing state, stale-then-current values, and retry behavior. The
default response remains the fallback when no scenario matches.

**Example:** A first lookup returns balance 42 from a stale snapshot; the next
matching call in the same run returns balance 39 from a refreshed snapshot.

### Slide 6 — Verify the run, not only the individual call

Use a shared run ID across all calls in one agent execution. Configure literal
final-answer checks (`contains`, `not_contains`, and `before`) and exact
`tool_sequence` checks to confirm tool choice and order. Optional Semantic QA
can compare a final answer against successful, timestamped mock responses.

**Important distinction:** Literal checks are deterministic text/sequence
checks. Semantic QA is an optional model-based evaluation, not a correctness
guarantee.

### Slide 7 — Make regressions visible

The dashboard streams new execution logs and final-answer submissions through
Supabase Realtime. Successful saved calls can be replayed against the current
mock configuration and compared with the original saved response. This helps
spot when a changed schema, scenario, or response altered behavior.

Replay is a comparison against the current mock; it does not create another
gateway log or reproduce an external service interaction.

### Slide 8 — Fit the team's access and operating model

Workspaces group tools, logs, API keys, analytics, and members. Tools can be
open or protected with revocable bearer keys. Usage is limited by plan and,
when a key is used, by that key's monthly cap. Workspace roles distinguish
owners/admins from members for management tasks.

**Talk track:** "The same test bench can start as a personal workspace and
grow into a shared team workflow."

### Slide 9 — A deployable foundation

The application uses Next.js App Router, TypeScript, Supabase Auth and
Postgres, AJV, optional Upstash rate limiting, and Dodo Payments for
subscriptions. Server-side service-role access is reserved for trusted
operations such as the public gateway; dashboard reads are governed by
workspace membership and row-level security.

### Slide 10 — The ask

Start by moving one agent tool behind a MockAgent endpoint. Validate its
argument contract, add one difficult scenario, run the agent with a unique
run ID, and inspect the complete trajectory. Expand coverage only after the
first tool is passing.

## 3. A short live demo script

This uses an `issue_refund` example. It is suitable for a five-minute
walkthrough.

### Before the demo

- Have a MockAgent workspace and one tool called `issue_refund`.
- For a real server-backed demo, configure Supabase and sign in.
- To protect the endpoint, create a key and enable **Key required** for that
  tool. For a quick local test, an open-access tool is simpler.
- Keep a unique run ID for the demonstration, such as `refund-demo-2026-10-12`.

### Demo sequence

1. **Show the contract.** The schema requires `user_id` as a string; `reason`
   is optional.
2. **Call the VIP case.** Send `user_id: "vip"` and `reason: "duplicate"`.
   Explain the matched scenario and the returned VIP-specific mock response.
3. **Call a normal case.** Send a different user ID. Explain that it falls
   through to the default response.
4. **Call an invalid case.** Omit `user_id` or send it as a number. Show the
   structured validation response and the matching `SCHEMA_VIOLATION` log.
5. **Repeat the same invalid call using the same run ID.** Explain that a
   repeated identical validation failure is marked non-retryable rather than
   inviting a pointless retry.
6. **Inspect the dashboard.** Point out input, response, status, scenario,
   run ID, and latency. Replay a successful call to compare its original
   response with the current mock.
7. **If time permits, submit final text.** Run the configured answer checks
   using the same run ID and show the separate literal and semantic results.

## 4. Guided setup

### Prerequisites

- Node.js compatible with the project's Next.js version.
- A Supabase project for authentication and persistent data.
- Optional integrations: Upstash Redis for shared gateway rate limits,
  a compatible LLM endpoint for Semantic QA, and Dodo Payments for paid plans.

### Start the web app

From the repository root:

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Fill in `.env.local` using the descriptions in `.env.example` and the setup
instructions in [README.md](./README.md). Do not commit `.env.local` or put a
service-role key in a `NEXT_PUBLIC_*` variable.

### Initialize Supabase

1. Run [schema.sql](./schema.sql) in the Supabase SQL editor. It creates and
   upgrades the tables, workspace helpers, plan/quota functions, retention
   function, views, and RLS policies used by the app.
2. Enable Supabase Realtime for `public.logs` so the live execution-log table
   can receive inserts. The schema conditionally adds final-answer submissions
   to the Realtime publication when that publication exists.
3. Configure email/password auth. If GitHub login is wanted, also enable the
   GitHub provider and configure its callback in Supabase.
4. Configure the local and deployed redirect URLs, including
   `/auth/callback`, as described in the README.

The first registered account is initialized with a personal workspace and
owner membership by a database trigger.

### Environment variable groups

| Variables | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser-safe Supabase connection and user-session clients. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only trusted operations that must bypass RLS. Never expose it to client code. |
| `NEXT_PUBLIC_APP_URL` | Public origin used to display endpoint URLs and construct auth/billing redirects. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Shared gateway limits. Production requests fail closed with `503` when this is not configured or available. |
| `CRON_SECRET` | Bearer secret for the scheduled expired-log cleanup endpoint. |
| `SEMANTIC_JUDGE_BASE_URL`, `SEMANTIC_JUDGE_API_KEY`, `SEMANTIC_JUDGE_MODEL` | Optional OpenAI-compatible Semantic QA judge configuration. For Baseten hackathon credits use `https://inference.baseten.co/v1` and `meta-models/muse-spark-open-1026`; keep the key server-side. |
| `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_WEBHOOK_KEY`, `DODO_PAYMENTS_ENVIRONMENT`, `DODO_PAYMENTS_SOLO_PRODUCT_ID`, `DODO_PAYMENTS_TEAM_PRODUCT_ID` | Optional checkout, subscription webhook, and plan integration. |

The local development gateway can run without Upstash configuration. The
application still needs Supabase credentials to create users, tools, and logs.

## 5. Create a tool: the core example

Create a tool in the dashboard using **New Mock Tool**. The form submits to a
server action, which parses the JSON, validates the tool schema and each
scenario schema, resolves the current workspace and plan, and inserts the tool.

### Example tool definition

**Name:** `issue_refund`

**Description:** `Issue a refund for a user and reason.`

**Expected JSON Schema:**

```json
{
  "type": "object",
  "properties": {
    "user_id": { "type": "string" },
    "reason": { "type": "string" }
  },
  "required": ["user_id"],
  "additionalProperties": false
}
```

`additionalProperties: false` is optional but useful when the test should catch
unexpected arguments. AJV uses `allErrors: true`, so callers receive multiple
violations together.

**Default response:**

```json
{
  "success": true,
  "message": "Refund processed."
}
```

**Conditional response scenarios:**

```json
[
  {
    "name": "VIP user",
    "match": {
      "type": "object",
      "properties": {
        "user_id": { "const": "vip" }
      },
      "required": ["user_id"]
    },
    "response": {
      "success": true,
      "message": "VIP refund processed."
    }
  },
  {
    "name": "Balance refresh",
    "match": {
      "type": "object",
      "properties": {
        "user_id": { "const": "retry-demo" }
      },
      "required": ["user_id"]
    },
    "responses": [
      {
        "success": true,
        "balance": 42,
        "as_of": "stale snapshot"
      },
      {
        "success": true,
        "balance": 39,
        "as_of": "refreshed snapshot"
      }
    ]
  }
]
```

Scenarios are checked in array order; the first matching JSON Schema wins.
Each scenario must have a non-empty name, an object-valued `match` schema, and
exactly one of `response` or a non-empty `responses` array. A scenario with a
single `response` returns it whenever it matches. A sequence uses the shared
run ID to count earlier successful calls to that scenario; the last response
repeats after the sequence is exhausted. Without a run ID, each request starts
at the first response.

The dashboard displays the URL in this form:

```text
{NEXT_PUBLIC_APP_URL}/api/v1/mock/{toolId}
```

The tool ID is generated by the database; copy the actual URL from the
dashboard rather than making one up.

## 6. Call the gateway

### HTTP example

With a protected tool, include its bearer key. Remove the authorization header
for an open-access tool.

```powershell
curl.exe -X POST "https://YOUR_APP/api/v1/mock/YOUR_TOOL_ID" `
  -H "Content-Type: application/json" `
  -H "x-mockagent-run-id: refund-demo-2026-10-12" `
  -H "Authorization: Bearer YOUR_API_KEY" `
  --data-raw "{\"user_id\":\"vip\",\"reason\":\"duplicate\"}"
```

Successful result:

```json
{
  "success": true,
  "message": "VIP refund processed."
}
```

The response also carries `x-mockagent-status`, `x-mockagent-scenario`,
`x-mockagent-scenario-step`, `x-mockagent-run-id`, and
`x-mockagent-latency-ms` headers when relevant.

### JavaScript / TypeScript SDK

The JavaScript package source is in
[packages/mockagent-js](./packages/mockagent-js); its npm package name is
`trymockagent`.

```javascript
import { randomUUID } from "node:crypto";
import { MockAgent, MockAgentError } from "trymockagent";

const mock = new MockAgent({
  toolId: process.env.MOCKAGENT_TOOL_ID,
  apiKey: process.env.MOCKAGENT_API_KEY, // only for a protected tool
});
const runId = randomUUID();

try {
  const result = await mock.call(
    { user_id: "vip", reason: "duplicate" },
    { runId },
  );
  console.log(result);
} catch (error) {
  if (error instanceof MockAgentError) {
    console.error({
      status: error.status,
      body: error.body,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }
  throw error;
}
```

### Python SDK

The Python client is in
[packages/mockagent-python](./packages/mockagent-python). It is included as
source and is not currently published to PyPI. Install it locally from that
directory with `python -m pip install .`.

```python
import uuid
from trymockagent import MockAgent, MockAgentError

mock = MockAgent(
    tool_id="YOUR_TOOL_ID",
    api_key="YOUR_API_KEY",  # only for a protected tool
)
run_id = str(uuid.uuid4())

try:
    result = mock.call(
        {"user_id": "vip", "reason": "duplicate"},
        run_id=run_id,
    )
    print(result)
except MockAgentError as error:
    print(error.status, error.body, error.retryable, error.retry_after_seconds)
    raise
```

Both clients can also fetch the schema (`getTool()` / `get_tool()`) and submit
final text (`submitFinalAnswer()` / `submit_final_answer()`). Neither SDK
retries automatically. The caller should inspect the error and apply bounded
retry behavior only when the response says it is retryable.

## 7. What happens inside a gateway request

The public route is
[app/api/v1/mock/[toolId]/route.ts](./app/api/v1/mock/[toolId]/route.ts).
External agents do not need a Supabase dashboard session. The route uses the
server-only admin client to load the tool and store execution logs.

### `POST /api/v1/mock/{toolId}`

1. Apply the client/IP rate limit.
2. Validate the tool ID and parse the JSON request body.
3. Validate an optional `x-mockagent-run-id` (maximum 128 printable
   characters).
4. Load the tool definition. A missing tool is `404`; an inactive tool is
   `409`.
5. If the tool requires a key, validate the bearer token against a stored
   SHA-256 hash using a timing-safe comparison.
6. Apply the per-tool rate limit and atomically consume workspace and optional
   API-key monthly usage through the Postgres `consume_gateway_call` function.
7. Validate arguments against the tool's JSON Schema with AJV.
8. For invalid arguments, record a failure fingerprint and, when a run ID was
   provided, look for an identical earlier failure in that run. The first
   correctable validation failure is `400`; an identical repeat is `409` with
   `retryable: false`. A malformed tool schema is a permanent tool
   configuration problem rather than a caller correction.
9. For valid arguments, choose the first matching scenario or use the default
   response. Save the response snapshot, scenario metadata, run ID, status,
   payload, and latency to `logs`.
10. Return the response JSON, or a structured validation error.

An execution log write failure is reported to server logs but does not block a
valid mock response from returning. A separate failure to load state needed
for duplicate detection or scenario sequencing returns a transient error.

The monthly quota check happens before schema validation, so an attempted tool
call that reaches the gateway consumes usage even if its arguments fail
validation. Calls rejected earlier by authentication or rate limits do not
reach that quota consumption step.

### `GET /api/v1/mock/{toolId}`

GET is a rate-limited schema and description preview for browser sanity checks.
It applies the per-tool key requirement where enabled, but it does not run a
tool call or consume the monthly gateway-call quota. Agents should use POST
for actual tool calls.

### Error behavior at a glance

| Situation | Typical HTTP status | Meaning |
| --- | ---: | --- |
| Malformed JSON / invalid run ID | `400` | Fix the request format. |
| Missing tool | `404` | Check the copied tool ID. |
| Inactive tool or identical repeated bad arguments in a run | `409` | Stop or change the request/configuration. |
| Missing/invalid bearer key | `401` | Configure a key if the tool is protected. |
| First caller schema violation | `400` | Correct the reported argument paths. |
| Invalid stored tool schema | `500` | The tool owner needs to fix the tool configuration. |
| Quota or rate limit exceeded | `429` | Respect `Retry-After`; do not retry in a tight loop. |
| Gateway dependency unavailable | `503` | Transient service/configuration issue; retry only in a bounded way. |

Exact response shapes vary by error. Inspect `error_code`, `error_class`,
`retryable`, validation `errors`, and `Retry-After` rather than relying only
on the HTTP status.

## 8. Run IDs, scenarios, and repeatability

A run ID is a caller-generated correlation key. Reuse one ID for all mock-tool
calls belonging to one agent execution; generate a new ID for the next run.
The gateway accepts an omitted run ID for ordinary tool calls, but run-based
features need it:

- Scenario response sequences count successful calls per tool, run ID, and
  scenario.
- Duplicate validation failure detection compares earlier identical failures
  within the same tool and run.
- Final-answer submission requires the run ID and uses it to retrieve calls
  and evidence.
- `tool_sequence` assertions gather calls across tools in the same workspace
  and run.

The example `Balance refresh` sequence returns 42 on the first matching
successful call with a run ID and 39 on the next. A call with a different run
ID starts over at 42. Schema-invalid requests do not advance successful
scenario response sequences.

## 9. Final-answer QA: deterministic checks and optional judge

Configure checks in the tool's **Run & final-answer assertions** and
**Semantic QA criteria** fields. Then, after the agent finishes, submit its
final text to:

```text
POST {NEXT_PUBLIC_APP_URL}/api/v1/mock/{toolId}/final-answer
```

The request must contain the same run ID as the tool calls and a body such as:

```json
{
  "final_answer": "The VIP refund was processed."
}
```

### Literal assertions

Assertions are validated when a tool is created. Each needs a unique name.
There can be at most 30 configured assertions.

**Text contains a required phrase:**

```json
{
  "name": "Confirm refund",
  "type": "contains",
  "text": "refund was processed"
}
```

**Text must not contain a forbidden phrase:**

```json
{
  "name": "No unsupported guarantee",
  "type": "not_contains",
  "text": "guaranteed"
}
```

**One phrase must appear before another:**

```json
{
  "name": "Explain stale data first",
  "type": "before",
  "first": "stale snapshot",
  "then": "refreshed balance"
}
```

Text checks are literal and case-insensitive by default. Set
`case_sensitive: true` for case-sensitive matching. `before` checks the
positions of the first occurrence of each phrase.

**Exact tool sequence:**

```json
{
  "name": "Refund flow",
  "type": "tool_sequence",
  "tools": [
    "lookup_order",
    "check_refund_eligibility",
    "issue_refund"
  ]
}
```

This is an exact ordered comparison: missing calls, additional calls, a
different valid tool, or a reordered call make it fail. It includes logged
calls across tools in the workspace, including schema violations, and supports
runs of up to 500 calls. The run must contain at least one call to the tool
whose endpoint receives the final-answer submission.

### Optional Semantic QA

Semantic QA is configured as a natural-language criterion, for example:

```text
Use the newest timestamped balance; do not report a stale value as current.
```

The server sends the criterion, final answer, and up to 50 successful,
timestamped response records from that tool/run to the configured
OpenAI-compatible judge. The serialized evidence is bounded before sending.
The answer and evidence leave MockAgent and are processed by the configured
judge provider; do not enable this for sensitive data without approving that
data flow.

Semantic results can be `passed`, `failed`, `error`, or `not_configured`.
Literal and semantic results are returned separately and stored separately.
The legacy top-level `passed` field represents literal assertions only; when
there are no literal assertions it is false even if Semantic QA passes. Read
the `literal` and `semantic` objects for the full result. A judge result is an
evaluation aid, not proof of correctness.

## 10. Dashboard tour

After sign-in, `/dashboard` resolves the user's current workspace and loads
its data.

| Dashboard area | What it shows or does |
| --- | --- |
| **Stats cards** | Tool count, total calls, and schema violations. |
| **Workspace** | Switch or create workspaces, view members, invite by email, and remove eligible members. |
| **Plan and billing** | Current plan/status and limits, paid-plan checkout, and the Dodo billing portal. Active and past-due subscriptions receive paid limits; other subscription states use Free limits, and an existing subscription must be managed before starting another checkout. |
| **Usage analytics** | Up to 30 daily usage rows, a recent-call chart, average latency, violations, and manager-controlled log retention. |
| **Agent Playground** | Run a prompt through the configured model with selected active, open-access mock tools; inspect the answer and tool calls. Each mock call is logged and counts toward usage limits. |
| **Regression Tests** | Save a prompt, selected tools, exact tool-call sequence, required answer phrases, and JSON response assertions (dot paths with equality, containment, existence, or numeric checks); run one test or a confirmed sequential batch, track progress and detailed expected/actual results, inspect bounded traces, and compare with the previous run. Analytics summarize pass rates, seven-day outcomes, trend windows, common failed checks, per-test streaks/reliability, model results, and average tool calls from the latest 100 loaded runs. |
| **MockAgent Assistant** | Ask the Baseten-powered assistant for guidance on tool contracts and tests. It does not automatically access workspace data. |
| **Mock Tools** | Create and edit tool definitions, copy endpoint URLs, enable/disable tools, require/remove key protection, or delete tools. Configuration edits preserve the endpoint ID and snapshot the previous definition for revision history and restore. Deleting a tool also deletes its associated logs and revisions. |
| **API Keys** | Owners/admins can create and revoke workspace keys and set a per-key monthly limit. The full key is shown once. |
| **Execution Logs** | Recent calls, input, saved response, status, scenario/step, run ID, latency, and replay comparison. New log inserts appear through Supabase Realtime. |
| **Run & Final-Answer Checks** | Recent submitted answers and literal/semantic results, updated through Supabase Realtime. |

Before using tool revision history on an existing Supabase project, re-run
[schema.sql](./schema.sql). It safely adds the revision table, its workspace
read policy, and a trigger that retains up to 50 previous configurations for
each tool. A restore is saved as a new revision, so it can also be undone.

The Agent Playground runs at most five mock calls per run and supports up to
eight selected tools. Protected tools are excluded for now. Prompts and tool
outputs are sent to the configured model provider; each mock call still passes
through the public gateway and is subject to its rate limits and workspace
usage quota.

Regression tests use those same Playground limits and tool restrictions. A
test passes only if its configured exact sequence/answer phrases pass and every
tool call succeeds with HTTP 2xx. The latest 50 runs per test are retained.
Run the latest [schema.sql](./schema.sql) before creating suites; saved tests
and their results are workspace-scoped.

## 11. Workspaces, limits, and billing

### Workspace model

Tools, logs, API keys, and final-answer submissions are workspace-scoped. A
new user gets a workspace and owner membership. Invited users are added as
members; workspace management actions are restricted to owners/admins.
Workspace membership is enforced in server actions and backed by row-level
security policies.

### Plans in this project

| Plan | Monthly calls | Tools | Seats | API keys | Maximum log retention |
| --- | ---: | ---: | ---: | ---: | ---: |
| Free | 1,000 | 3 | 1 | 2 | 7 days |
| Solo | 20,000 | 25 | 1 | 10 | 30 days |
| Team | 100,000 | 250 | 10 | 50 | 90 days |

The dashboard lists Solo at $19/month and Team at $79/month. The paid plan is
active for limit purposes when the subscription status is `active` or
`past_due`; otherwise the effective plan falls back to Free.

Monthly workspace and API-key quotas are incremented atomically in Postgres.
Upstash enforces a sliding window of 60 requests per minute per client IP and
120 requests per minute per tool. Production requires Upstash configuration;
local development may run without it. Self-hosting deployments should ensure
their reverse proxy writes a trustworthy client IP header because the gateway
uses forwarded IP headers for client-level limiting.

### Payments

Dodo Payments is optional for local development. Production billing needs the
plan product IDs, API key, environment, webhook signing key, and the
subscription event webhook configured as described in the README. The
webhook verifies signatures and records webhook IDs to avoid processing
duplicates. Subscription events update the workspace plan, status, period end,
and retention allowance.

## 12. Data model and persistence

The database schema lives in [schema.sql](./schema.sql). The main records are:

- **`workspaces`** — plan, subscription, retention, and workspace identity.
- **`workspace_members`** — user-to-workspace membership and role.
- **`user_settings`** — current workspace selection.
- **`tools`** — schema, default response, scenarios, QA rules, key requirement,
  and active state.
- **`api_keys`** — name, prefix, hash, monthly limit, and revocation time.
- **`workspace_usage` / `api_key_usage`** — month-bucket counters updated
  atomically by `consume_gateway_call`.
- **`logs`** — input/output snapshots, status, latency, run ID, scenario step,
  failure fingerprint, and validation details.
- **`final_answer_submissions`** — final text and saved literal and semantic
  evaluation results.
- **`dodo_webhook_events`** — webhook idempotency records.

`daily_usage` and `tool_stats` are database views for aggregates. The schema
includes indexes for run/scenario lookup and applies RLS to user-facing data.
Authenticated users can read data for their workspace membership; the public
gateway uses the admin client only on the server for external calls. Logs are
append-only from the dashboard perspective.

The cleanup job calls `delete_expired_logs`, which removes both old execution
logs and old final-answer submissions using the workspace's retention period,
capped by that plan's retention maximum.

## 13. Architecture and request paths

```text
Browser / developer
  |
  +--> Next.js landing page and interactive browser-only demo
  |
  +--> Supabase Auth --> protected /dashboard
                         |
                         +--> Server Components load workspace data
                         +--> Server Actions create/manage tools, keys,
                         |    workspaces, retention, and billing sessions
                         +--> Realtime subscriptions refresh logs and checks

Agent or test harness
  |
  +--> POST /api/v1/mock/{toolId}
  |      -> client/tool rate limits
  |      -> tool/key/quota checks
  |      -> AJV schema validation
  |      -> scenario/default response
  |      -> append execution log
  |
  +--> POST /api/v1/mock/{toolId}/final-answer
         -> key/quota checks and run lookup
         -> literal assertions
         -> optional semantic judge
         -> save submission

Vercel scheduled job --> GET /api/cron/cleanup-logs
                         -> bearer CRON_SECRET check
                         -> delete_expired_logs database function

Dodo Payments --> signed /api/billing/webhook
                  -> verify signature and deduplicate event
                  -> update workspace plan/status
```

### Frontend and server boundaries

- `app/` contains App Router pages, route handlers, and server actions.
- React client components in the dashboard handle interactive controls and
  Realtime subscriptions.
- `lib/supabase/client.ts` creates the browser-safe Supabase client using the
  public anon key.
- `lib/supabase/server.ts` creates the cookie-aware user client and the
  server-only admin client.
- `proxy.ts` and `lib/supabase/middleware.ts` refresh sessions and redirect
  unauthenticated dashboard requests to `/login`.
- `types/database.ts` contains generated-style database types.

### Core helpers

- `lib/validators.ts` owns the shared AJV instance and schema helpers.
- `lib/scenarios.ts` parses scenario configuration, selects the first matching
  scenario, and resolves sequence steps.
- `lib/gateway-guards.ts` enforces API keys, usage quotas, and rate limits.
- `lib/rate-limit.ts` configures shared Upstash sliding-window limiters.
- `lib/final-answer-assertions.ts` validates and evaluates deterministic
  checks.
- `lib/semantic-evaluation.ts` calls the configured compatible judge and
  validates its response shape.
- `lib/billing.ts` centralizes plan limits; `lib/dodo.ts` configures the
  payments SDK.

## 14. Repository map

```text
README.md                           Setup, configuration, deployment, and product notes
walkthrough.md                      This pitch and end-to-end walkthrough
schema.sql                          Supabase tables, triggers, functions, views, and RLS
app/page.tsx                         Marketing landing page
app/InteractiveToolDemo.tsx          Local browser-only schema/scenario demo
app/login/ and app/*-password/        Authentication and password-reset pages
app/dashboard/page.tsx               Workspace dashboard data loader and layout
app/dashboard/components/             Dashboard panels, tools, logs, and checks
app/actions/auth.ts                  Supabase sign-in, sign-up, reset, and sign-out
app/actions/tools.ts                 Tool, key, replay, and key-protection actions
app/actions/settings.ts              Workspace, members, and retention actions
app/actions/billing.ts                Dodo checkout and billing portal actions
app/api/v1/mock/[toolId]/route.ts     Public tool GET/POST gateway
app/api/v1/mock/[toolId]/final-answer/route.ts
                                     Final-answer and run QA endpoint
app/api/billing/webhook/route.ts      Signed Dodo subscription webhook
app/api/cron/cleanup-logs/route.ts    Retention cleanup endpoint
lib/                                 Validation, scenarios, guards, integrations
packages/mockagent-js/                JavaScript/TypeScript SDK source and tests
packages/mockagent-python/            Dependency-free Python SDK source and tests
types/database.ts                    Typed Supabase database model
vercel.json                          Daily cleanup schedule (03:00 UTC)
```

## 15. Auth, privacy, and operational boundaries

- The Supabase anon key is used for user-session clients; the service-role key
  bypasses RLS and must stay server-side.
- API keys are generated with random bytes, shown only when created, and stored
  as SHA-256 hashes plus a lookup prefix. Revoking a key sets its
  `revoked_at`; the stored key cannot be retrieved later.
- Protected tools require `Authorization: Bearer ...`. The SDKs can attach the
  key but do not make a browser application a safe place to store it; keep
  production keys on a trusted server.
- Request arguments, successful response snapshots, final answers, and
  evaluation results are stored in the database. Treat test payloads as
  persisted data and do not send secrets unless your retention and access
  controls permit it.
- Semantic QA sends the final answer and selected successful response evidence
  to the configured judge provider.
- Log retention is plan-limited and cleanup runs daily at 03:00 UTC in the
  configured Vercel deployment. Local environments do not automatically run
  the scheduled Vercel job.
- The gateway is intentionally public to external agent clients; its
  credentials and server-side admin access are not exposed to those clients.

## 16. Development and verification

From the repository root:

```powershell
npm run dev
npm run lint
npm test
npm run build
```

`npm test` runs the root final-answer assertion tests. The JavaScript SDK has
its own tests:

```powershell
Push-Location packages\mockagent-js
npm test
Pop-Location
```

The Python client tests can be run from its package directory:

```powershell
Push-Location packages\mockagent-python
python -m unittest
Pop-Location
```

The root package also includes `npm run db:types` for regenerating Supabase
types when `SUPABASE_PROJECT_ID` is configured.

## 17. Product strengths and honest limitations

### Strengths

- A real HTTP contract that can be used by frameworks and plain HTTP clients.
- Explicit, multi-error JSON Schema validation.
- Named conditional responses and per-run response sequences.
- Correlation across tools with run IDs.
- Deterministic checks for answer text and exact tool order.
- Optional evidence-based semantic evaluation.
- Live execution visibility and response replay comparisons.
- Workspace-scoped access, revocable keys, rate limits, quotas, and retention.
- Lightweight JavaScript/TypeScript and dependency-free Python clients.

### Boundaries to explain in a pitch or handoff

- The product mocks tools; it does not connect to or validate a production
  service's real behavior.
- The landing-page demo is local-only and is not a live gateway test.
- Text assertions are literal checks, not semantic truth checks.
- Semantic QA depends on an external configured judge and is not a guarantee.
- Replay compares a saved successful response to today's configured mock; it
  is not a full recording/replay of the agent, model, or external systems.
- Run IDs are supplied by the caller. Calls without a run ID cannot be joined
  into reliable run-level scenario sequences or final-answer QA.
- The current UI does not edit an existing tool's schema/scenarios after
  creation.
- The Python SDK is in the repository but is not published to PyPI.

## 18. Suggested closing

"MockAgent gives your team a controlled endpoint for every agent tool, useful
contract errors when arguments are wrong, repeatable responses for edge cases,
and a visible record of what happened. Start with one tool, run your agent
against the mock, and fix the failures before a real service is in the loop."
