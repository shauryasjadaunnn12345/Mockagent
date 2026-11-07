# Hosted MCP endpoint: findings and Phase 1 plan

**Status:** Phase 1 is implemented in the working tree; migration and deployment verification remain.
**Inspected:** 2026-11-07.
The repository findings below describe the state before implementation.

## Repository findings

| Area | Finding |
|---|---|
| Framework and runtime | Next.js 16.3.6 App Router with React 19.2.8. The public HTTP mock route is explicitly `runtime = "nodejs"` and `dynamic = "force-dynamic"`; Vercel is the deployment target indicated by `vercel.json`, the production URL in the README, and the existing Vercel cron for log cleanup. |
| Language | TypeScript 5.5, `strict: true`; imports use the `@/*` workspace alias. |
| Database | Supabase PostgreSQL via `@supabase/supabase-js` and `@supabase/ssr`; no ORM. `schema.sql` is the schema/migration source in this checkout, and `types/database.ts` contains the typed database model. There is no checked-in versioned migration directory. |
| Tool definitions | `public.tools` stores `name`, `description`, `json_schema`, `mock_response`, ordered `scenarios`, `workspace_id`, activation state, and per-tool `require_api_key`. Tools belong directly to workspaces; neither workspace slugs nor toolsets/tool groupings currently exist. |
| HTTP mock execution | `app/api/v1/mock/[toolId]/route.ts` currently contains the gateway lifecycle inline: load/activate tool, enforce client and tool rate limits, authenticate, consume quota, validate via AJV (`lib/validators.ts`), select matching scenario, derive sequence step from prior logs for the run, resolve transient failures, write a log row, and return the HTTP result. Scenario/sequence/fault helpers are in `lib/scenarios.ts` and `lib/chaos.ts`. There is no separate shared execution function yet. |
| Logs | `public.logs` stores workspace/tool/user IDs, arguments (`payload`), response, status, API key ID, scenario and step, run ID, validation/error details, failure fingerprint, and latency. Logs are scoped by workspace for dashboard queries and are pruned by `delete_expired_logs()` according to workspace plan retention. The table currently requires a tool ID and has no transport or JSON-RPC fields, so it cannot represent discovery/list/initialize events without a schema adjustment. |
| API keys | `public.api_keys` stores a workspace ID, 24-character prefix, SHA-256 hash, monthly limit, and revocation time. `lib/gateway-guards.ts` validates bearer keys by workspace and compares hashes with `timingSafeEqual`; the gateway only requires a key when the tool's `require_api_key` is true. |
| Quotas and rate limits | `enforceWorkspaceQuota()` calls the atomic `consume_gateway_call` database function. Workspace quotas are 1,000 calls/month for free, 20,000 for solo, and 100,000 for team; an API key can impose a lower monthly limit. Upstash rate limits are 60 requests/minute per client IP and 120/minute per tool. Production fails closed if the shared client limiter is unconfigured. |
| Tenant boundaries | Workspace memberships and row-level security protect dashboard reads. Public gateway routes use the Supabase service-role client, so every lookup/write must explicitly constrain workspace and toolset IDs. API-key verification already binds a key to the tool's workspace. |
| Dashboard | The UI is one `/dashboard` page, not a set of toolset pages. `ToolList` renders individual tool cards and HTTP URLs; `LogsTable` renders workspace logs and subscribes to workspace-filtered inserts. A toolset manager/detail page and MCP connection panel will need to be added. |
| Tests | `npm test` runs Node's built-in `node:test` against `.mjs` tests (some import TypeScript modules directly). There is no existing MCP test harness or configured Supabase integration-test environment. Tests should exercise a dependency-injected MCP handler and shared execution path with fakes, plus schema/query-isolation checks. |

## Official MCP specification checks

The current official revision is [2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28.md). The relevant references are [Architecture](https://modelcontextprotocol.io/specification/2026-07-28/architecture.md), [Versioning and Compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning.md), [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http.md), [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover.md), [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools.md), and [Base Protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic.md).

Differences or details to account for:

1. `server/discover` is a mandatory standard method in this revision. Its result uses `supportedVersions`, capabilities, and server identity in `_meta["io.modelcontextprotocol/serverInfo"]`; the implementation should use this shape rather than inventing a parallel discovery API.
2. The current revision's HTTP `HeaderMismatch` is code `-32020` (not a generic `-32600`), with HTTP `400`. Unsupported versions use `-32022`, message `Unsupported protocol version`, and list supported versions in error data; HTTP status is `400`.
3. Current `tools/list`, `tools/call`, and discovery results include `resultType` (use `"complete"` for these non-paginated responses). The prompt omits it, so it will be included for spec compatibility.
4. Current HTTP clients must send an `Accept` header that lists both `application/json` and `text/event-stream`, even when the server chooses a single `application/json` response. The current revision removed the GET stream endpoint and protocol-level sessions; returning 405 for GET and avoiding SSE/session state meet the requested design.
5. Current per-request metadata uses `_meta["io.modelcontextprotocol/protocolVersion"]` and `_meta["io.modelcontextprotocol/clientInfo"]`; `MCP-Protocol-Version` must match the body version. The inspected official HTTP request-metadata section documents this version header, but not `Mcp-Method` or `Mcp-Name`. Per the prompt, treat those as optional MockAgent integrity hints: compare them to the body and reject disagreement, never use them as the execution source.
6. The current spec requires validating any supplied `Origin` and returning 403 when invalid, to mitigate DNS rebinding. It also defines notifications as no-response messages; the requested 202 with an empty body is the corresponding HTTP behavior.
7. Legacy revisions are the `initialize`-handshake era (`2025-11-25` and earlier). The server will implement the requested legacy handshake and `ping` without issuing or requiring sessions, and will not implement deprecated HTTP+SSE.

No MCP SDK or new dependency is planned. A small, typed JSON-RPC handler is suitable for the stateless, bounded method set and avoids relying on an SDK's support for both eras before verifying it.

## Proposed Phase 1 implementation

### Data model and migration

- Add a unique, stable workspace slug and `toolsets` plus `toolset_tools` tables. A toolset is workspace-owned and has its own slug; the join table selects and orders existing workspace tools.
- Store the toolset's auth mode and only a hash of any open-URL token. Enforce workspace consistency in relationships/queries and add indexes for slug and toolset membership lookups.
- Extend `logs` additively with transport, JSON-RPC method, MCP tool name, toolset reference, and `traceparent`. Permit a null `tool_id` for MCP protocol-level requests (such as discovery/list/initialize), while retaining workspace/user attribution and existing tool-linked behavior. Default existing/new HTTP logs to `transport = "http"`.
- Update `types/database.ts`. Existing `tools.description` and `json_schema` cover the required MCP name/description/input schema. `outputSchema` and annotations are optional and have no existing persisted fields, so omit them rather than add columns unless implementation finds a concrete need.
- Update RLS policies and workspace dashboard queries for toolsets and MCP logs. Apply the existing workspace retention cleanup to all MCP rows.

### Server and shared execution

- Add `app/api/mcp/[workspaceSlug]/[toolsetSlug]/route.ts` as a dynamic Node.js POST endpoint. Resolve the workspace/toolset pair and member tools with explicit tenant constraints.
- Add a pure protocol handler module for bounded JSON parsing, JSON-RPC validation, current/legacy version handling, origin and request-header validation, standard errors, notifications, and `server/discover`, `tools/list`, and `tools/call`. Keep protocol parsing separate from Next.js transport concerns so it can be tested with Node's existing test runner.
- Extract the existing gateway's validation/scenario/sequence/fault/logging core to one shared execution function. Refactor the HTTP route to use it without changing its public request or response contract, then call that same function from MCP.
- On MCP calls, preserve the current sequence/run semantics and quota accounting. Take run ID from MCP `_meta` or `X-Run-Id` (and preserve HTTP's existing `x-mockagent-run-id` behavior); capture only the specified trace context. Do not log authorization values or URL tokens.
- Use the workspace API-key validator and `consume_gateway_call` quota path. Rate-limit list/discover without consuming call quota, and count each tool call once. Return validation/scenario/fault failures as `isError: true` tool results with safe, corrective messages and retry hints where applicable.
- Reject external `$ref` values without resolving them; bound request, schema complexity/depth, response size, and execution. The existing AJV validation is synchronous, so a hard timeout needs a design that actually bounds CPU work (not just a `Promise.race` around synchronous validation).

### Dashboard, docs, and tests

- Add toolset creation/management and a `/dashboard/toolsets/[slug]` detail page to assign tools and show the MCP URL, copy control, auth mode, and setup snippets. Verify Claude, Cursor, and VS Code snippets against their current official client documentation; mark any unverified format TODO rather than guessing.
- Extend execution logs with a visible MCP badge and JSON-RPC method while preserving HTTP display and realtime updates.
- Update README, `docs/README.md`, and `docs/ARCHITECTURE.md`; add `scripts/mcp-smoke.sh` with curl examples and MCP Inspector instructions.
- Add Node tests for discovery/list/call and legacy initialization, header/body and version errors, invalid/unknown tools, scenario/sequence/fault parity, auth and cross-workspace isolation, quota/rate limits, external `$ref` rejection, and excessive schema depth.
- Validate the refactored HTTP gateway contract with the existing tests and targeted new tests; then run `npm test`, TypeScript/build validation, and lint on touched files.

## Risks and open decisions

- **Existing grouping model:** none exists. The proposed toolset tables and assignment UI are necessary to satisfy the requested workspace/toolset URL, rather than exposing every workspace tool implicitly.
- **URL token placement:** the requested open-mode URL needs to carry a bearer-equivalent secret. A query parameter preserves the stated route shape, but URLs can be retained in browser history, client configuration, and infrastructure request logs. A path suffix also changes the route shape and may be logged. Confirm the preferred placement before implementation.
- **Per-tool API-key protection:** MCP toolsets add a new auth mode alongside existing per-tool `require_api_key`. The safe default is that MCP must not weaken a member tool's existing key requirement; this can mean an API key remains required even if a toolset has an open URL token. Confirm whether to enforce this inheritance or treat toolset auth as an override.
- **Request logging vs. sensitive data:** the requested arguments/results can themselves contain secrets. Follow existing retention controls, never log credentials/headers, and avoid returning raw internal schema or database errors. A policy for sensitive argument/result fields may be needed later.
- **Production integration coverage:** current tests do not connect to a configured Supabase database or Upstash. Unit fakes can test authorization/query scoping and quota handling, but production RLS, RPC limits, and provider configuration still need deployment-level verification.
- **Client verification:** setup snippets depend on each client's current remote-server configuration support and auth handling. Do not promise interoperability until tested with MCP Inspector and at least one real client as required by the definition of done.
- **Phase 2 is excluded:** protocol fault presets and explicit state handles remain deferred until Phase 1 is merged and separately confirmed.

## Phase 1 implementation record

Implemented locally:

- Added workspace slugs, `toolsets`, `toolset_tools`, MCP log metadata, and
  workspace-scoped RLS in `schema.sql`; aligned `types/database.ts`.
- Added the stateless MCP route and protocol handler, with the supported
  `2026-07-28` revision plus legacy `initialize` compatibility through
  `2024-11-05`. Method/name/version routing hints are checked against the
  JSON-RPC body; only the current protocol revision is advertised as current,
  while supported legacy versions are also listed.
- Extracted `executeMockTool` and routed both HTTP and MCP calls through it.
  Added bounded worker-based validation, external `$ref` rejection, and MCP
  request/result/execution limits.
- Added one-time URL-token auth (hash only at rest), workspace-bound bearer-key
  checks, existing quota/rate-limit integration, MCP log metadata, dashboard
  toolset management, connection snippets, MCP log badges, and
  [`docs/MCP.md`](./MCP.md).
- Added Node tests for protocol, auth/tenant isolation, quotas/rate limits,
  schema bounds, and shared execution parity. Added
  [`scripts/mcp-smoke.sh`](../scripts/mcp-smoke.sh).
- No MCP SDK or new runtime dependency was added. Client configuration links
  and formats are documented in the MCP guide and dashboard panel.

The approved choices are reflected in the code: open authentication uses a
query-string URL token; an existing member tool's API-key requirement is not
weakened by an open toolset URL. Before production use, apply the schema changes
and test the route against the deployed Supabase policies and rate-limit
configuration. Real-client verification remains a deployment acceptance step.
