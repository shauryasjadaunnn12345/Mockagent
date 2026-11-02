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

## Main components

| Area | Responsibility |
|---|---|
| `app/` | Next.js pages, dashboard, server actions, and API route handlers. |
| `app/api/v1/mock/[toolId]/route.ts` | Public mock-tool gateway: loads a tool, enforces access controls, validates arguments, resolves scenarios, logs calls, and returns a mock response or structured error. |
| `app/api/agent/run/route.ts` | Runs a saved regression case through the configured model and tools, evaluates checks, and persists run history. |
| `lib/` | Reusable schema validation, scenario handling, coverage analysis, trace shaping, quota helpers, provider integration, and other domain logic. |
| `schema.sql` | Supabase tables, indexes, policies, triggers, and RPC functions. Apply it to a development database before using database-backed workflows. |
| `types/database.ts` | TypeScript model of the Supabase schema. Keep it aligned with schema changes. |
| `packages/` | SDK source packages. The JavaScript/TypeScript SDK is published as `trymockagent`; the Python SDK is currently source-only. |
| `scripts/mockagent-ci.mjs` | CI runner for saved regression suites; returns a nonzero exit code when checks fail. |
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
