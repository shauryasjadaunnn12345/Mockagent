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
4. Auth → Providers: enable **GitHub** OAuth if you want that login option
   (set the callback URL to `https://<your-domain>/auth/callback`).
5. Project Settings → API: copy the Project URL, anon key, and service role key.

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
DODO_PAYMENTS_API_KEY=
DODO_PAYMENTS_WEBHOOK_KEY=
DODO_PAYMENTS_ENVIRONMENT=test_mode
DODO_PAYMENTS_SOLO_PRODUCT_ID=
DODO_PAYMENTS_TEAM_PRODUCT_ID=
```

`SUPABASE_SERVICE_ROLE_KEY` is used only in `lib/supabase/server.ts`
(`createAdminClient`) by the public gateway route — it is never sent to the
browser. Keep it out of any `NEXT_PUBLIC_*` variable.

Create an Upstash Redis database and set its REST URL and token in the two
`UPSTASH_REDIS_*` variables. The gateway allows 60 requests per minute per
client IP and 120 requests per minute per tool. In production, the gateway
returns `503` if rate limiting is not configured or Upstash is unavailable;
local development can run without Upstash credentials.

## 3. Install & run

```bash
npm install
npm run dev
```

Visit `http://localhost:3000`, sign up, and you'll land on `/dashboard`.

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
4. Returns `mock_response` (200) on success, or a 400 with detailed AJV
   errors your agent can use to self-correct and retry.

`GET` on the same URL returns the tool's schema and description, handy for a
quick sanity check in a browser.

## 5. Deploying to Vercel

1. Push this repo to GitHub.
2. Import it in Vercel, add the same env vars from `.env.local`.
3. Set `NEXT_PUBLIC_APP_URL` to your production domain (e.g.
   `https://mockagent.yourdomain.com`) — it's used to build the gateway URLs
   shown in the dashboard.
4. Deploy.
5. Set `CRON_SECRET` in Vercel. Vercel sends it to the scheduled cleanup route as a bearer token.

## 6. Scenarios, keys, and teams

- Add ordered JSON Schema match scenarios to a mock tool. The first match returns its response; otherwise the default response is returned.
- Successful logs keep response snapshots. Replay compares the current result with that saved response without adding a gateway log.
- API keys are displayed only once and stored as SHA-256 hashes. Turn on `Key required` per tool, then send `Authorization: Bearer <key>`. Monthly limits are enforced atomically.
- Workspaces share tools and logs. Owners/admins can invite by email, manage API keys, and set retention to 7, 30, or 90 days.
- Daily analytics show calls, schema violations, and average latency. Vercel runs the cleanup cron at 03:00 UTC; logs older than the workspace retention period are removed.
- Dodo Payments plans: Free (1,000 calls, 3 tools), Solo ($19/month; 20,000 calls, 25 tools), and Team ($79/month; 100,000 calls, 250 tools, 10 seats). Limits are enforced in server actions and Postgres.
- In Dodo Payments, create monthly subscription products matching the plan amounts. Set each product ID in `DODO_PAYMENTS_SOLO_PRODUCT_ID` or `DODO_PAYMENTS_TEAM_PRODUCT_ID`, configure the API key and `test_mode`/`live_mode`, then register `https://<your-domain>/api/billing/webhook` for `subscription.active`, `subscription.updated`, `subscription.past_due`, `subscription.on_hold`, `subscription.paused`, `subscription.unpaused`, `subscription.renewed`, `subscription.plan_changed`, `subscription.cancelled`, `subscription.expired`, and `subscription.failed`. Set the endpoint signing secret as `DODO_PAYMENTS_WEBHOOK_KEY` and redeploy.

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
