# Configuration reference

The hosted production service is [mockagent.online](https://mockagent.online).
This page covers configuration for local development and separate
self-hosted deployments; those settings do not configure the hosted service.

Copy [`.env.example`](../.env.example) to `.env.local` for local development.
Use your deployment platform's secret manager in production. Never commit
`.env`, `.env.local`, provider credentials, or API keys.

## Application and database

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL used by the app. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase public/anonymous key used by the client. This is intentionally public, but must be protected by correct Supabase RLS policies. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase service role key. Never expose it to browser code. |
| `NEXT_PUBLIC_APP_URL` | Public base URL used when constructing tool gateway URLs. Use `http://localhost:3000` for the default local server and HTTPS in production. |

Apply [`schema.sql`](../schema.sql) to the Supabase database before using
database-backed features. Reapply additive updates when upgrading existing
development deployments. A successful build does not apply or validate a live
database migration.

## Rate limiting and scheduled cleanup

| Variable | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint used for shared rate limiting. |
| `UPSTASH_REDIS_REST_TOKEN` | Server-side Upstash credential. |
| `CRON_SECRET` | Secret used to authorize the scheduled log-cleanup endpoint. Configure it to match the deployment's scheduled job. |

## Meta-compatible model provider

The first-party Meta Model API is preferred when configured:

| Variable | Purpose |
|---|---|
| `MODEL_API_KEY` | Server-side credential for the Meta Model API. Its presence selects the first-party provider. |
| `META_MODEL` | Default Muse model; the example default is `muse-spark-1.3`. |
| `META_MODEL_API_BASE_URL` | Model API base URL; the example default is `https://api.meta.ai/v1`. |

If `MODEL_API_KEY` is not set, the compatible provider variables can be used:

| Variable | Purpose |
|---|---|
| `SEMANTIC_JUDGE_BASE_URL` | Compatible chat-completions API base URL; `.env.example` uses Baseten. |
| `SEMANTIC_JUDGE_API_KEY` | Server-side provider credential. |
| `SEMANTIC_JUDGE_MODEL` | Model identifier available from the configured provider. |

For the Meta coverage demo, `GEMINI_API_KEY` enables Gemini as the preferred
fallback when the first-party Meta API returns HTTP 429. `GEMINI_MODEL` selects
the Gemini model and defaults to `gemini-3.8-flash`. If Gemini is not
configured, the demo falls back to the compatible provider above. These
Gemini variables do not change the provider used by other AI features.

The configured provider powers AI-assisted tool and regression drafts,
explanations, contract review, semantic evaluation, and Playground runs.
Requests send the relevant prompts, tool definitions, and run evidence to the
provider. Review generated content; do not include sensitive data without
approval.

The Meta coverage demo retries through Gemini first, or the compatible provider
if Gemini is not configured, when the first-party Meta API returns HTTP 429.
Other AI features continue using the selected primary provider.

## Dodo Payments

| Variable | Purpose |
|---|---|
| `DODO_PAYMENTS_API_KEY` | Server-side Dodo Payments API credential. |
| `DODO_PAYMENTS_WEBHOOK_KEY` | Webhook signature verification key. |
| `DODO_PAYMENTS_ENVIRONMENT` | `test_mode` or `live_mode`. |
| `DODO_PAYMENTS_SOLO_PRODUCT_ID` | Dodo product configured for the Solo plan. |
| `DODO_PAYMENTS_TEAM_PRODUCT_ID` | Dodo product configured for the Team plan. |

Billing is deployment-dependent. Configure the provider credentials, webhook,
environment, and product IDs before enabling checkout. `npm run check:config`
checks configuration presence and format; it does not verify a live payment
checkout or webhook.

## Validation and related guides

```bash
npm run check:config
npm test
npm run lint
npm run build
```

The configuration check can fail when optional deployment capabilities such
as billing are incomplete. See [Run MockAgent locally](../RUN_LOCALLY.md) for
setup, and [Architecture](./ARCHITECTURE.md) for data and request flows.
