# MockAgent feature guide

MockAgent is a hosted test bench for AI-agent tools. Define mock tools, connect
an agent to them, and inspect repeatable runs without calling live business
services. This page summarizes the product; linked guides cover setup and
details.

## Typical workflow

1. Create a tool from scratch, import a definition, or draft one with Meta AI.
2. Define its JSON Schema, mock response, scenarios, and access settings.
3. Call it through HTTP or expose it in a hosted MCP toolset.
4. Run an agent in the Playground or execute saved regression tests.
5. Inspect logs and traces, fix issues, and replay or share a saved run with
   workspace teammates.

## Mock tools and endpoint behavior

- **Tool authoring:** Create and edit named tools with descriptions, object
  input schemas, JSON responses, scenarios, and optional API-key protection.
- **HTTP gateway:** Each tool has a `POST /api/v1/mock/{toolId}` endpoint.
  Requests are schema-validated and return a configured response or useful
  structured error. `GET` describes the tool.
- **Schema feedback:** Invalid arguments identify validation issues and are
  recorded as schema violations. External schema references are not fetched.
- **Conditional scenarios:** Match arguments against JSON Schema and return a
  scenario-specific response. The editor previews matching against sample
  input.
- **Response sequences:** Return different responses on successive matching
  calls with the same run ID; the last response repeats. Sequences can model
  simple per-run state, such as a first successful operation followed by a
  duplicate-attempt response. This is not a general-purpose state database;
  sequence progress is derived from retained logs.
- **Fault presets:** Schedule simulated `401`, `409`, `429`, `500`, `502`,
  `503`, or `504` failures at selected matching-call steps. Retry metadata
  and `Retry-After` are included when configured. These are HTTP response
  simulations, not real connection delays or truncated responses.
- **Safety guards:** Configure `call_guard` rules on JSON Pointer argument
  paths using `exists`, `equals`, `not_equals`, `lte`, or `gte`. Violating
  calls are blocked before scenario execution and logged as policy violations.
- **Tool revisions:** Compare saved configurations and restore an earlier
  revision.

## Import and generation

- **OpenAPI:** Preview tools from OpenAPI JSON or YAML, including supported
  operations and local references.
- **Function tools:** Import OpenAI and Anthropic function definitions.
- **MCP tool lists:** Import a `tools/list` result or compatible tools array.
- **HAR captures:** Import supported HAR 1.2 request/response exchanges
  offline to infer tools, scenarios, and sequences. No captured host is
  contacted; response status and headers are not replayed.
- **Meta AI Tool Studio:** Draft a tool name, description, schema, response,
  and scenarios from a natural-language request. Review and edit drafts
  before saving.

Imports are bounded and previewed before creation. Review generated content,
especially HAR data: redaction is heuristic and is not guaranteed to remove
all private data. See [Importing mock tools](./IMPORTING_TOOLS.md).

## Agent Playground and AI assistance

- **Agent Playground:** Select active tools, choose an available model, enter
  a prompt, and inspect the answer and ordered tool calls. Protected tools can
  receive temporary API keys that are not added to the model prompt or saved
  with the run.
- **Meta AI features:** Depending on provider configuration, use tool
  generation, a dashboard assistant, regression-case drafting, failure
  explanations, contract-risk reviews, and semantic answer evaluation.
- **Semantic QA:** Compare a final answer with successful tool evidence and
  timestamps. This model-based assessment can be wrong and is not a proof of
  correctness.
- **Data flow:** Prompts, tool definitions, and relevant run evidence used by
  AI features are sent to the configured model provider. Provider credentials
  remain server-side.

## Regression testing and coverage

- **Saved suites:** Group up to 20 named prompt cases, selected tools, and
  expected behavior.
- **Deterministic checks:** Check exact ordered tool calls, required or
  forbidden answer text, and JSON response fields or shapes.
- **Semantic checks:** Optionally evaluate answer support against tool
  evidence using the configured model judge.
- **Execution controls:** Run one case or a suite, inspect per-check results,
  and stop after the active case.
- **Run history:** Store results, checks, run IDs, prompt snapshots, and
  bounded traces. Replay against current configuration or saved tool
  snapshots; branch a run with an edited prompt or model.
- **Coverage-guided drafts:** Generate editable test prompts aimed at
  arguments, enum values, scenarios, or response steps not seen in recent
  saved traces.
- **Auto-Improve:** Measure baseline coverage, review generated cases, and
  confirm bounded rounds to measure observed changes.
- **Failure follow-ups and contract reviews:** Draft evidence-linked
  explanations, follow-up tests, or advisory contract-risk prompts. These
  drafts do not alter tools automatically.
- **Suite portability:** Export and import versioned JSON bundles, mapping
  imported tool names to active tools in the destination workspace.

Coverage describes only the saved traces currently available to the analysis;
it does not measure every workspace call or guarantee agent correctness.

## Logs, traces, and collaboration

- **Execution logs:** Inspect arguments, responses, status, latency, scenario
  and step, run ID, validation outcome, and transport. MCP rows also show the
  JSON-RPC method and tool name.
- **Replay comparisons:** Replay a saved successful mock call against the
  current tool configuration and compare responses.
- **Analytics:** Review usage and latency summaries, regression trends,
  recurring failures, model breakdowns, and trace-based coverage.
- **Share run:** Copy a link to a saved regression trace. Viewers must sign in
  and belong to that run's workspace; the page is not public and is excluded
  from search indexing.
- **Workspace collaboration:** Workspaces scope tools, suites, runs, logs,
  members, and API keys. Membership roles and plan entitlements control
  management actions.

## Hosted MCP

Expose selected workspace tools at
`POST /api/mcp/{workspaceSlug}/{toolsetSlug}`. The stateless endpoint supports
tool discovery, listing, calling, and legacy initialization/ping. Configure a
workspace API key or use the toolset's unguessable open URL token. Tool calls
reuse HTTP validation, scenarios, sequences, fault simulation, quotas, and
logs. See [Hosted MCP servers](./MCP.md) for client setup and limits.

## SDK, CI, plans, and access

- **JavaScript/TypeScript SDK:** Install the published
  [`trymockagent`](https://www.npmjs.com/package/trymockagent) package.
- **Python SDK:** Source is in the repository; it is not published on PyPI.
- **CI runner:** Run saved suites with `scripts/mockagent-ci.mjs`; failures
  return a nonzero exit code.
- **Pull-request feedback:** An optional GitHub Actions workflow reports
  hosted suite results in a PR comment when repository secrets are configured.
- **API keys:** Workspace-scoped bearer keys can be limited and revoked. Keys
  are shown only when created. Tool-level and MCP access settings determine
  when a key is required.
- **Quotas and retention:** Plans set monthly mock-call and AI-request quotas,
  tool and seat limits, API-key limits, and maximum log retention. Gateway and
  AI rate limits also apply. Paid billing availability depends on deployment
  configuration.

See [Plans and usage in the README](../README.md#plans-and-usage), the
[configuration reference](./CONFIGURATION.md), and the
[local setup guide](../RUN_LOCALLY.md).

## Important boundaries

- MockAgent returns configured mock data; it does not connect imported
  definitions or HAR captures to live upstream APIs.
- AI-generated tools, tests, explanations, risk reviews, and semantic scores
  are suggestions to inspect, not guarantees.
- Test suites and coverage use saved traces and available history; they do not
  prove complete behavior.
- Logs and traces may contain supplied arguments, prompts, and responses.
  Avoid production secrets and sensitive personal data.
- A local test or successful build does not verify live database migrations,
  authentication, provider connectivity, billing, or deployed rate limits.

## More documentation

- [Documentation index](./README.md)
- [Architecture and data boundaries](./ARCHITECTURE.md)
- [Product README and API examples](../README.md)
- [Run MockAgent locally](../RUN_LOCALLY.md)
- [Product walkthrough](../walkthrough.md)
