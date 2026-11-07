# Self-hosting MockAgent

MockAgent can run as your own Next.js application. A self-hosted instance is
operated and secured by you; it does not connect to or configure the hosted
service at `mockagent.online`.

## Required services

- **Node.js 20 or later** and npm.
- **Supabase** for Postgres, authentication, and workspace data.
- A **Meta-compatible model provider** for the Playground and AI-assisted
  workflows. Configure the first-party Meta Model API or the documented
  compatible provider.
- **HTTPS** and deployment-managed environment secrets for production.

Upstash Redis is recommended for consistent shared rate limits across multiple
app instances. Dodo Payments is optional and is needed only if you intend to
offer paid checkout/subscriptions in your own deployment.

## Deploy

1. Fork or clone the repository and install the locked dependencies:

   ```bash
   npm ci
   ```

2. Create a Supabase project. Apply [`schema.sql`](../schema.sql) to its
   database before using dashboard features. For upgrades, review and reapply
   the additive schema. Test migrations in a non-production project first.

3. Configure the required variables from
   [`.env.example`](../.env.example) in your local `.env.local` or your hosting
   provider's secret manager. Set `NEXT_PUBLIC_APP_URL` to the HTTPS origin of
   your deployment. Keep `SUPABASE_SERVICE_ROLE_KEY`, provider keys, API keys,
   payment credentials, and telemetry headers server-side.

4. Build and start the Node.js app:

   ```bash
   npm run build
   npm run start
   ```

   A Next.js-compatible Node hosting platform can run the app. The MCP,
   gateway, and agent routes explicitly use the Node.js runtime; do not deploy
   them to an Edge-only runtime.

5. Configure a scheduled request to `GET /api/cron/cleanup-logs` with the
   `Authorization: Bearer <CRON_SECRET>` header. Without it, expired logs are
   not cleaned on schedule.

6. Verify configuration and run the test suite before opening access:

   ```bash
   npm run check:config
   npm test
   npm run lint
   npm run build
   ```

   `check:config` requires the billing settings if the deployment expects
   checkout to be enabled. Builds and tests do not verify live Supabase
   policies, provider credentials, Redis, payment checkout, or migrations.

## Environment and operations

See the [configuration reference](./CONFIGURATION.md) for all settings.
At minimum, supply the Supabase URL, public anon key, service-role key, public
app URL, and a model-provider configuration. Use Upstash Redis in
multi-instance production deployments. Configure Dodo product IDs and
webhook verification only if enabling billing.

Run the app on a supported Node.js hosting platform. This repo does not
currently include an official Docker image or Compose deployment. Keep Node.js
and dependencies patched, restrict database and collector access, use TLS,
rotate secrets, configure backups, and monitor the host and Supabase project.

Supabase row-level security is part of the tenant boundary. Do not expose the
service-role key to client code. Apply the repository's schema and test
workspace isolation in your own staging environment before onboarding users.
The host operator is responsible for data residency, retention, access
requests, incident response, and compliance obligations.

### Optional OpenTelemetry export

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to an OTLP/HTTP collector base URL, for
example `https://otel-collector.example.com`. MockAgent exports operational
spans and metrics for tool calls, MCP requests, and saved regression runs.
Alternatively set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` and/or
`OTEL_EXPORTER_OTLP_METRICS_ENDPOINT` to their explicit OTLP/HTTP endpoints.

The exporter sends only the event category, outcome, low-cardinality
transport, duration, and configured service name. It does not export prompts,
tool names or IDs, arguments, responses, workspace/user IDs, API keys, or run
IDs. Export is disabled when no endpoint is configured. Configure
`OTEL_EXPORTER_OTLP_HEADERS` in the hosting secret manager if the collector
requires authentication; use HTTPS for non-local collectors. Export requests
are bounded to one second and telemetry delivery failures do not fail a
MockAgent request.

The application sends data to the collector you configure. Review your
collector's retention, access controls, and privacy settings.

## Related guides

- [Local development](../RUN_LOCALLY.md)
- [Configuration reference](./CONFIGURATION.md)
- [Architecture and data boundaries](./ARCHITECTURE.md)
