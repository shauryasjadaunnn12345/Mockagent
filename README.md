# MockAgent

Tool-mocking and schema-validation platform for developers building AI agents.
Create virtual tool endpoints, validate agent tool-call JSON against a schema
with AJV, and watch execution logs stream in live.

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind CSS · shadcn/ui-style components ·
Supabase (Postgres, Auth, Realtime) · AJV

## 1. Supabase setup

1. Create a project at https://supabase.com.
2. In the SQL editor, run `schema.sql` (tables, workspaces, RLS policies, usage views, and quota/retention functions). Re-run it after updates; the additions are designed to be safe for existing data.
3. **Enable Realtime** on the `logs` table: Database → Replication → toggle
   `public.logs` on. This powers the live-updating log table on the dashboard.
4. Auth → Providers → GitHub: enable GitHub OAuth and copy the callback URL
   shown by Supabase. Set that URL as the **Authorization callback URL** in
   your GitHub OAuth App (it will look like
   `https://<project-ref>.supabase.co/auth/v1/callback`). Copy the GitHub
   OAuth App's client ID and client secret back into the Supabase GitHub
   provider settings.
5. Authentication → URL Configuration: add your app URLs to the redirect
   allow list, including `https://<your-domain>/auth/callback` and
   `http://localhost:3000/auth/callback` for local development. Set
   `NEXT_PUBLIC_APP_URL` to the deployed app origin.
6. Project Settings → API: copy the Project URL, anon key, and service role key.

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in the Supabase values plus your
deployment URL:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
NEXT_PUBLIC_APP_URL=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
CRON_SECRET=
SEMANTIC_JUDGE_BASE_URL=https://inference.baseten.co/v1
SEMANTIC_JUDGE_API_KEY=
SEMANTIC_JUDGE_MODEL=meta-models/muse-spark-open-1026
DODO_PAYMENTS_API_KEY=
DODO_PAYMENTS_WEBHOOK_KEY=
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_PAYMENTS_SOLO_PRODUCT_ID=
DODO_PAYMENTS_TEAM_PRODUCT_ID=
```

`SUPABASE_SERVICE_ROLE_KEY` is used only in `lib/supabase/server.ts`
(`createAdminClient`) by the public gateway route — it is never sent to the
browser. Keep it out of any `NEXT_PUBLIC_*` variable.

To use your Baseten hackathon credits for Semantic QA, set these values in
`.env.local` (the Baseten key is server-side only):

```
SEMANTIC_JUDGE_BASE_URL=https://inference.baseten.co/v1
SEMANTIC_JUDGE_API_KEY=<your Baseten API key>
SEMANTIC_JUDGE_MODEL=meta-models/muse-spark-open-1026
```

Use the exact model name above; the hackathon key is restricted to that model.
Retrieve the one-time key link yourself, save the key in `.env.local`, and
never commit or share it or place it in a `NEXT_PUBLIC_*` variable. Restart
the dev server after changing environment variables. In production, set the
same variables in your hosting provider's server-side environment settings.
Then open the dashboard to use the Baseten-powered **MockAgent Assistant** for
questions about designing mock tools and tests. The assistant is a chat helper;
it does not have automatic access to workspace data or replace an IDE coding
assistant such as GitHub Copilot. The same Baseten configuration also enables
Semantic QA criteria on tools, which evaluates final answers against logged
tool evidence.

The dashboard's **Agent Playground** also runs a prompt with the Baseten model
and selected active mock tools. It supports up to eight selected tools and five
tool calls per run; each tool call goes through its normal gateway and counts
toward MockAgent usage limits. For now, tools that require their own MockAgent
API key are not available in the Playground. Prompts, tool arguments, and
responses are sent to Baseten during a run, so avoid sensitive data.
The Assistant, Playground, and semantic answer judge share a monthly AI request allowance per workspace:
100 on Free, 1,000 on Solo, and 5,000 on Team. Each Baseten completion request
counts once, including every tool-calling turn in a Playground run or semantic evaluation. A shared
rate limit allows up to 10 AI requests per workspace per minute. Current monthly
AI usage and the remaining allowance appear in the dashboard billing panel.

Create an Upstash Redis database and set its REST URL and token in the two
`UPSTASH_REDIS_*` variables. The gateway allows 60 requests per minute per
client IP and 120 requests per minute per tool. In production, the AI endpoints
and gateway return `503` if rate limiting is not configured or Upstash is
unavailable; local development can run without Upstash credentials.

## 3. Install & run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, sign up, and you'll land on `/dashboard`.

Before deploying, run the local checks:

```bash
npm test
npm run check:config
```

The configuration check loads the applicable local `.env` files and never prints
secret values. Production configuration requires HTTPS, Supabase credentials,
Upstash rate limiting, and `CRON_SECRET`. If a Baseten key is set, the check
enforces the hackathon model name. Dodo billing must be configured with the
API key, webhook key, both product IDs, and an explicit test/live environment.
Warnings identify optional integrations that are not configured.

The test suite checks application logic and important SQL/schema contracts; it
does not apply `schema.sql` to a real Postgres database or call Dodo. Before
launching paid plans, apply the current schema to a clean Supabase test project,
verify rerunning it against an existing database, then use Dodo `test_mode` to
complete checkout and confirm the signed webhook updates the right workspace
and limits. Do not switch to `live_mode` until those checks pass.

## 4. How the gateway works

Each tool you create gets a URL:

```
POST {NEXT_PUBLIC_APP_URL}/api/v1/mock/{toolId}
```

Point your agent framework's tool-call handler at that URL. The route:

1. Loads the tool's `json_schema` and `mock_response`.
2. Validates the request body against `json_schema` with AJV
   (`allErrors: true`, so every violation is reported at once).
3. Writes a row to `logs` — `SUCCESS` or `SCHEMA_VIOLATION` — with latency.
4. Returns `mock_response` (200) on success, or structured AJV errors (400)
   with error codes, validation paths, and a stable failure fingerprint.

Send a unique `x-mockagent-run-id` for each agent run. Within that run, the
gateway fingerprints the tool and normalized arguments: the first schema
failure is correctable, while an identical repeat returns 409 with
`retryable: false`. Rate limits and temporary gateway failures include a
transient error class and `Retry-After` guidance; back off and keep retries
bounded. Calls without a run ID still receive structured schema errors but
cannot be checked against earlier calls in that run.

`GET` on the same URL returns the tool's schema and description, handy for a
quick sanity check in a browser.

## Agent Playground and regression tests

The authenticated dashboard's Agent Playground sends a prompt to the configured
OpenAI-compatible model and gives it selected active mock tools. Each tool call
uses the regular mock gateway, gets logged, and counts toward workspace and
rate limits. Runs are limited to five tool calls; tools requiring API-key
protection are not currently available in the Playground.

Save repeatable regression tests with up to 20 named prompt cases, selected tools, an optional
exact ordered tool-call expectation, and required answer phrases. Running a
saved test runs every case sequentially with the same expectations and records
each case's run ID, trace, and server-evaluated checks independently; the latest
50 case runs per test are retained. The overall test passes only when every
case's configured expectations pass and every tool request returned HTTP 2xx.
Phrase checks are
case-insensitive substring checks, not semantic correctness checks.

Tests can also assert fields in a tool's JSON response using dot paths (for
example `data.status` or `items.0.id`) and equals, contains, exists, greater
than, or less than checks. Each assertion checks the first response from that
tool in the run; failed checks show expected and actual values.

Each new saved-test run also stores a bounded trace of tool arguments, mock
responses, HTTP statuses, and the final answer. The dashboard displays the
latest trace and compares it with the previous run. Trace data is workspace
scoped; review it for sensitive values just as you would execution logs.
Use **Run all** to run every saved test case sequentially with a live progress
and pass/fail/error summary. The dashboard asks for confirmation because each
case may make multiple model requests; **Stop after current** prevents
remaining cases from starting without interrupting the in-progress request.

The regression analytics panel summarizes the latest 100 saved runs: overall
pass rate, a seven-day pass/fail chart, recent-versus-prior trend, recurring
failed checks with failure rates, reliability per test, latest pass/fail
streaks, model breakdown, and average tool calls where valid traces exist.
Trend windows compare the newest up to ten runs with the immediately preceding
equally sized window; analytics describe only the loaded history, not every run
ever retained.

Run the latest `schema.sql` in Supabase to create workspace-scoped test and run
tables, tool-response assertions, and the trace column before using this
feature. Prompts and mock tool responses are sent to the configured model
provider. Do not include sensitive data in a test unless that data flow is
approved.

## 5. Client SDKs

The JavaScript/TypeScript client is published on npm as `trymockagent`. It calls
tools with JSON, associates calls with a run ID, retrieves a tool's schema, and
submits configured final-answer QA:

```bash
npm install trymockagent
```

```js
import { MockAgent } from "trymockagent";

const mock = new MockAgent({ toolId: "YOUR_TOOL_ID" });
const result = await mock.call({ user_id: "vip", reason: "duplicate" }, {
  runId: "unique-run-id",
});
```

Install the unpublished Python client from the source directory:

```bash
cd packages/mockagent-python
python -m pip install .
```

```python
from trymockagent import MockAgent

mock = MockAgent(tool_id="YOUR_TOOL_ID")
result = mock.call({"user_id": "vip", "reason": "duplicate"}, run_id="unique-run-id")
```

The Python client source is included in the repository but has not been
published to PyPI yet. Use the HTTP endpoint directly if you don't want to
install from source.

Pass `apiKey` (JavaScript) or `api_key` (Python) when a tool requires bearer-key
protection. Both SDKs expose error status, response body, retryability, and
`Retry-After` guidance without retrying automatically. The package source and
full examples are in [`packages/mockagent-js`](./packages/mockagent-js) and
[`packages/mockagent-python`](./packages/mockagent-python).


##  Scenarios, keys, and teams

- Edit an existing mock tool from its dashboard card. Changes are validated
  before saving, preserve its endpoint ID, and automatically snapshot the
  previous configuration. Open **Edit** to view the 20 most recent revisions
  and restore one; restoration itself creates a revision of the configuration
  it replaces. The schema caps history at 50 revisions per tool. Re-run
  `schema.sql` in Supabase to create the revision table and policies.
- Add ordered JSON Schema match scenarios to a mock tool. A scenario can return one `response` or a `responses` sequence; otherwise the default response is returned. For a sequence, use a new `x-mockagent-run-id` per test run and pass it on each call. Responses advance per matching successful call and the last response repeats. Without a run ID, each call receives the first response.
- Successful logs keep response snapshots, sequence steps, and run IDs; the dashboard lets you inspect the returned JSON. Replay compares the configured response for that saved step without adding a gateway log.
- Configure run and final-answer assertions on a tool. `contains`, `not_contains`, and `before` rules check final text. A `tool_sequence` rule checks the exact tool names and order across every call logged with the run ID, so it catches valid calls to the wrong tool as well as reordered, missing, or extra calls. For example, `{ "name": "Refund flow", "type": "tool_sequence", "tools": ["lookup_order", "check_refund_eligibility", "issue_refund"] }`. Submit the agent's final text to `POST {NEXT_PUBLIC_APP_URL}/api/v1/mock/{toolId}/final-answer` with `x-mockagent-run-id` matching its tool calls and JSON body `{ "final_answer": "..." }`. The route returns each rule's result and stores the submitted answer for dashboard review. Text checks are literal and case-insensitive unless configured otherwise; they do not assess whether wording is semantically correct. Tool sequence checks include successful calls and schema violations, and support runs with up to 500 calls.

  To demo a wrong-but-valid tool choice, create mock tools named `lookup_order`, `check_refund_eligibility`, `issue_refund`, and `get_shipping_status`, then configure the exact sequence above on `issue_refund`. POST valid payloads to the tool endpoints with the same unique `x-mockagent-run-id`, but call `get_shipping_status` instead of `check_refund_eligibility`. Submit the final answer to the `issue_refund` tool's `/final-answer` URL with that same run ID. The refund-flow assertion fails and its detail shows the actual ordered tool names; replacing the wrong call with `check_refund_eligibility` makes it pass.
- Configure optional Semantic QA criteria on a tool to judge whether the final answer is supported by successful, timestamped tool responses for that run. The judge uses `SEMANTIC_JUDGE_BASE_URL` (defaults to OpenAI-compatible `/v1`), `SEMANTIC_JUDGE_API_KEY`, and `SEMANTIC_JUDGE_MODEL`; judge credentials stay server-side. To use the Baseten hackathon credits, set the base URL to `https://inference.baseten.co/v1` and the model to `meta-models/muse-spark-open-1026`. The final-answer endpoint returns distinct `literal` and `semantic` results. Literal status is `passed`, `failed`, or `not_configured`; semantic status is `passed`, `failed`, `error`, or `not_configured`. Its legacy top-level `passed` field still represents literal assertions only. Semantic QA sends the final answer and successful response bodies/timestamps to the configured judge; treat it as model-based evidence, not a guarantee of correctness.
- API keys are displayed only once and stored as SHA-256 hashes. Turn on `Key required` per tool, then send `Authorization: Bearer <key>`. Monthly limits are enforced atomically.
- Workspaces share tools and logs. Owners/admins can invite by email, manage API keys, and set log retention up to their plan's limit (7 days for Free, 30 for Solo, 90 for Team).
- Daily analytics show calls, schema violations, and average latency. Vercel runs the cleanup cron at 03:00 UTC; logs older than the workspace retention period are removed.
- Dodo Payments plans: Free (1,000 calls, 100 AI requests, 3 tools, 1 seat, 2 API keys, 7-day logs), Solo ($19/month; 20,000 calls, 1,000 AI requests, 25 tools, 1 seat, 10 API keys, 30-day logs), and Team ($79/month; 100,000 calls, 5,000 AI requests, 250 tools, 10 seats, 50 API keys, 90-day logs). Entitlements are calculated centrally in server code; gateway quotas and AI request quotas are enforced atomically in Postgres. `active` and `past_due` subscriptions receive paid limits; other statuses use Free limits. A `past_due` subscription is shown with a grace-period warning.
- The billing panel shows current workspace call and AI request counts and remaining monthly quotas from the same UTC usage counters used for enforcement. It displays “Usage unavailable” rather than inventing a value if a usage query fails.
- In Dodo Payments, create monthly subscription products matching the plan amounts. Set each product ID in `DODO_PAYMENTS_SOLO_PRODUCT_ID` or `DODO_PAYMENTS_TEAM_PRODUCT_ID`, configure the API key and `test_mode`/`live_mode`, then register `https://<your-domain>/api/billing/webhook` for `subscription.active`, `subscription.updated`, `subscription.past_due`, `subscription.on_hold`, `subscription.paused`, `subscription.unpaused`, `subscription.renewed`, `subscription.plan_changed`, `subscription.cancelled`, `subscription.expired`, and `subscription.failed`. Set the endpoint signing secret as `DODO_PAYMENTS_WEBHOOK_KEY` and redeploy. Webhook signatures are verified and the current subscription is fetched from Dodo before entitlements are updated, preventing stale events from granting or removing a newer subscription's limits.
- Re-run the latest `schema.sql` after deploying schema changes. It includes atomic monthly AI request usage and enforcement, plus checks for valid plan/status combinations, allowed retention values, and plan-specific retention ceilings. If a database already contains out-of-policy workspace values, the migration fails rather than silently rewriting subscription or retention data; correct those rows and rerun it.

## Project structure

```
schema.sql                          Supabase schema + RLS policies
lib/supabase/{client,server}.ts     Browser + server Supabase clients
lib/supabase/middleware.ts          Session refresh + route protection
lib/validators.ts                   AJV instance + schema validation helper
lib/rate-limit.ts                   Shared Upstash gateway rate limits
app/api/v1/mock/[toolId]/route.ts   Dynamic mock gateway (POST/GET)
app/dashboard/page.tsx              Dashboard: stats, tools, logs
app/dashboard/components/           StatsCards, ToolList, CreateToolDialog, LogsTable
app/actions/{tools,auth}.ts         Server actions (CRUD, auth)
app/login/page.tsx                  Email/password + GitHub sign-in
components/ui/                      shadcn/ui-style primitives
types/database.ts                   Typed Supabase schema
```

## Notes / production hardening ideas

- **RLS on logs**: the gateway writes logs via the service-role client
  because external agents aren't Supabase-authenticated users; RLS still
  restricts dashboard reads to each user's own rows.
- **Compiled-schema caching**: `lib/validators.ts` recompiles the AJV
  validator per request. For high-traffic tools, cache compiled validators
  in a `Map<toolId, ValidateFunction>` keyed on the schema's `updated_at`.
- **Trusted client IPs**: when self-hosting, configure the reverse proxy to
   overwrite `x-forwarded-for`; the gateway uses it for per-client limits.
