# MockAgent architecture

This document describes how a request moves through MockAgent. For local setup,
see [Run MockAgent locally](../RUN_LOCALLY.md); for user workflows, see the
[product walkthrough](../walkthrough.md).

## At a glance

```text
Agent / Playground
        |
        | JSON tool arguments + run ID
        v
Mock tool gateway: /api/v1/mock/{toolId}
        |
        +--> workspace tool configuration
        +--> API-key, rate-limit, and quota guards
        +--> JSON Schema validation
        +--> scenario / response sequence / injected failure
        +--> execution log

External MCP client
        |
        | JSON-RPC over stateless HTTP
        v
Hosted MCP: /api/mcp/{workspaceSlug}/{toolsetSlug}
        |
        +--> workspace-scoped toolset and member tools
        +--> URL-token / API-key, rate-limit, and quota guards
        +--> shared mock execution engine
        +--> MCP request and tool-call logs

Dashboard regression case
        |
        v
Agent run route
        |
        +--> configured Meta-compatible model
        +--> selected mock tools through the gateway
        +--> checks + bounded trace + saved run
        +--> optional current-config or saved-config replay
```

The model does not directly invoke external business services in this flow.
MockAgent executes the configured mock tools and returns their results to the
agent loop.

Exported HAR request/response pairs can be imported offline into tool
contracts, exact-match scenarios, and response sequences. Imports use the same
tool storage and shared execution engine; no captured URL is fetched. HAR
status codes and headers are not replayed.

## Main components

| Area | Responsibility |
|---|---|
| `app/` | Next.js pages, dashboard, server actions, and API route handlers. |
| `app/api/v1/mock/[toolId]/route.ts` | Public mock-tool gateway: loads a tool, enforces access controls, validates arguments, resolves scenarios, logs calls, and returns a mock response or structured error. |
| `app/api/mcp/[workspaceSlug]/[toolsetSlug]/route.ts` | Stateless MCP HTTP endpoint. Resolves tools only within the routed workspace/toolset, validates authentication and protocol requests, and dispatches list/call operations. |
| `app/api/agent/run/route.ts` | Runs a saved regression case through the configured model and tools, evaluates checks, and persists run history. |
| `lib/mock-execution.ts` | Shared validation, scenario/sequence/fault, and execution-log path used by both the HTTP gateway and MCP calls. |
| `lib/mcp-protocol.ts` | Stateless JSON-RPC dispatch, current/legacy protocol handling, and MCP error/result shaping. |
| `lib/` | Reusable schema validation, scenario handling, coverage analysis, trace shaping, quota helpers, provider integration, and other domain logic. |
| `schema.sql` | Supabase tables, indexes, policies, triggers, and RPC functions. Apply it to a development database before using database-backed workflows. |
| `types/database.ts` | TypeScript model of the Supabase schema. Keep it aligned with schema changes. |
| `packages/` | SDK source packages. The JavaScript/TypeScript SDK is published as `trymockagent`; the Python SDK is currently source-only. |
| `scripts/mockagent-ci.mjs` | CI runner for saved regression suites; returns a nonzero exit code when checks fail. |
| `.github/workflows/mockagent-pr-feedback.yml` | Posts an idempotent PR comment with saved-suite results and changed files; checks out only the trusted base revision. |
| `examples/` | Real-agent and integration examples, including a delayed-order refund regression. |

## Tool-call lifecycle

1. A client sends JSON arguments to a tool endpoint. An optional
   `x-mockagent-run-id` groups calls made by one agent run and makes sequenced
   scenario behavior repeatable.
2. The gateway loads the active tool and checks API-key requirements, rate
   limits, and workspace usage.
3. The gateway validates request arguments against the tool's JSON Schema.
   Invalid requests receive structured validation details and are logged.
4. For valid inputs, a matching scenario can replace the default response. A
   response sequence advances across matching calls in the run; configured
   transient failures can interrupt selected steps for deterministic retry
   tests.
5. The gateway records the execution and returns the result to the caller.

Call guards are evaluated after schema validation and before scenario matching.
A failed guard records a `POLICY_VIOLATION` and prevents the mock response or
sequence from executing. Response sequences provide per-run stateful behavior:
their current step is derived from prior matching execution logs for the same
tool, scenario, and run ID. Log retention therefore also bounds this state.
Fault presets model HTTP error responses at selected steps; timeout and partial
response presets do not simulate transport delays or truncated connections.

Saved regression runs have workspace-member-only detail pages. The link uses
the saved run record ID, but does not grant access: the page requires an
authenticated workspace member and is marked `noindex`.

## Hosted MCP lifecycle

1. A workspace member creates a toolset and assigns existing workspace tools.
   The route resolves the workspace slug and toolset slug together, then loads
   member tools constrained by both workspace and toolset IDs.
2. The stateless POST handler checks Origin, request size, JSON-RPC routing
   headers, protocol version, URL-token/API-key authorization, and rate limits.
   It supports modern `server/discover`, `tools/list`, and `tools/call` as well
   as the legacy `initialize`, `ping`, and initialized-notification flow; it
   does not issue session IDs or provide HTTP+SSE.
3. Each `tools/call` consumes the existing workspace/API-key quota and enters
   `executeMockTool`, the same engine used by the HTTP route. Validation,
   scenario sequencing, scheduled failures, and run-ID behavior stay aligned.
4. MCP protocol and tool calls are attributed to the workspace/toolset in
   `logs`; call rows include the MCP method and transport. Existing workspace
   retention cleanup applies to these rows.

See the [hosted MCP guide](./MCP.md) for client setup and operational limits.

## Regression execution and replay

The Agent Playground or regression endpoint asks the configured model to
choose among selected tools. MockAgent executes each selected tool call through
the gateway and returns the result for the next model turn. A saved regression
run records its checks, model, prompt snapshot, bounded trace, and versioned
tool configuration snapshot.

Replay can use current workspace configuration or the source run's saved tool
snapshot. The gateway accepts saved configuration only with a temporary
server-authorized token bound to the run, workspace, and tool set. The override
does not bypass current activation, API-key, rate-limit, or quota checks.
Historical configuration makes the mocked tools reproducible; it does not
make model output deterministic or recreate external services.

## Meta AI and data boundaries

Meta-compatible provider calls support tool generation, regression-case
generation, explanations, contract review, semantic evaluation, and the
Playground. Native first-party Model API Playground runs use Responses API
tool turns and encrypted reasoning replay. Provider keys are server-side.

Prompts, tool definitions, and relevant run evidence are sent to the configured
provider for AI workflows. Logs and traces may contain request arguments and
mock responses. Do not use secrets or sensitive production data in test
payloads unless the data flow is approved.

## What this architecture does not guarantee

- A successful build or unit test does not verify live Supabase policies,
  migrations, billing, provider credentials, or deployment behavior.
- Semantic model evaluation is fallible and is not a correctness proof.
- Coverage measures observed behavior in the loaded saved traces; it does not
  establish complete agent coverage.
- Saved-config replay restores mocked tool definitions only, not the exact
  model response or any external service state.
