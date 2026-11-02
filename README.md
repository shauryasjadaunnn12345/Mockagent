# MockAgent

**New here?** Start with the [60-second overview](#60-second-demo), then use
the [documentation index](./docs/README.md) to find setup, architecture, API,
and contribution guides.

[![CI](https://github.com/shauryasjadaunnn12345/Mockagent/actions/workflows/ci.yml/badge.svg)](https://github.com/shauryasjadaunnn12345/Mockagent/actions/workflows/ci.yml)
[Report a bug](https://github.com/shauryasjadaunnn12345/Mockagent/issues/new?template=bug_report.yml) · [Request a feature](https://github.com/shauryasjadaunnn12345/Mockagent/issues/new?template=feature_request.yml) · [Contributing](./CONTRIBUTING.md)

**MockAgent tests AI-agent tool behavior before it reaches production services.**
Define mock endpoints, schemas, scenarios, and response sequences to make edge
cases repeatable and observable.
Use Meta-powered coverage guidance to draft tests for behavior your agent has not exercised yet.

**[Open MockAgent](https://mockagent.online)** · [Create an account](https://mockagent.online/login?mode=signup) · [Log in](https://mockagent.online/login?mode=login)

## Find your way around

| I want to… | Start here |
|---|---|
| Understand the product and see the main workflow | [Product overview and 60-second demo](#60-second-demo) |
| Record a product demo | [Five-minute demo script](./docs/DEMO_SCRIPT.md) |
| Run the app locally | [Local setup guide](./RUN_LOCALLY.md) |
| Explore the product with a guided tour | [Product walkthrough](./walkthrough.md) |
| Understand the main components and request flow | [Architecture guide](./docs/ARCHITECTURE.md) |
| Configure environment variables and integrations | [Configuration reference](./docs/CONFIGURATION.md) |
| Use the real-agent example or CI runner | [Delayed-order example](./examples/delayed-order-refund/README.md) |
| Report a bug or suggest an improvement | [GitHub issue forms](https://github.com/shauryasjadaunnn12345/Mockagent/issues/new/choose) |
| Make a contribution | [Contributing guide](./CONTRIBUTING.md) |

For the full documentation map, see [docs/README.md](./docs/README.md).

### 60-second demo

**60-second demo GIF placeholder:** add the recording at
[`docs/media/mockagent-demo.gif`](./docs/media/mockagent-demo.gif).

### Quick start

1. Sign in at [mockagent.online](https://mockagent.online) and create a mock
   tool with a JSON Schema and response.
2. Add a scenario for an edge case, or use Tool Studio to draft a tool with
   Meta AI and review it before saving.
3. Call the tool from your agent or run it in Agent Playground; inspect the
   trace and logs.
4. Save a regression test, then choose **Auto-improve** to measure coverage
   and review Meta-generated cases targeting uncovered behavior.

### How Meta AI is used

| Workflow | Meta AI's role | What remains under your control |
|---|---|---|
| Tool Studio | Drafts a tool schema, response, and scenarios from a description. | Validate, edit, and confirm before the tool is saved. |
| Agent Playground | The configured Meta model chooses among selected tools and produces the answer. Native Model API uses Responses API tool turns and encrypted reasoning replay. | MockAgent executes the selected mock tools and shows the trace; quotas and rate limits apply. |
| Regression testing | Generates coverage-targeted test prompts, explains failed checks, drafts follow-ups, and reviews tool-contract risks. | All generated content remains a reviewable draft; coverage is measured by running confirmed tests. |
| Semantic QA and assistant | Judges answer support against supplied tool evidence or responds to the user's question. | Treat model output as fallible; review the supplied evidence and rationale. |

Tool definitions, prompts, and applicable run evidence are sent to the configured
Meta-compatible provider. See [Meta AI Tool Studio](#meta-ai-tool-studio) for
provider configuration and data-flow details.

### Why MockAgent

MockAgent focuses on mocked agent tools: schema-validated arguments,
conditional scenarios and response sequences, observable traces, and
coverage-guided regression-test generation from saved traces. This lets a team
exercise tool-boundary behavior without calling live business services.

**Competitor comparison: TODO — add repo-verified, sourced comparisons before
making comparative claims.**

## More features

### What you can do

- **Create mock tools** with a name, description, JSON Schema argument
  contract, and deterministic JSON response.
- **Test alternate outcomes** with conditional scenarios and ordered response
  sequences—useful for retries, stale data, and edge cases.
- **Run an AI agent against your tools** in the Agent Playground and inspect
  the model's answer and every tool call.
- **Generate a tool draft with Meta AI** from a plain-language description,
  review or edit the generated schema and scenarios, then create the mock tool.
- **Build repeatable regression tests** with named prompt cases, expected tool
  calls, answer checks, and assertions against JSON response fields.
- **Understand changes and failures** with execution logs, schema validation
  errors, run traces, replay comparisons, and regression analytics.
- **Control access and usage** with bearer API keys, shared workspaces, plan
  quotas, and log retention settings.

### Example mock tool

For a tool named `lookup_order`, an argument schema could be:

```json
{
  "type": "object",
  "properties": {
    "order_id": { "type": "string" }
  },
  "required": ["order_id"],
  "additionalProperties": false
}
```

Set a mock response such as:

```json
{
  "order_id": "order-123",
  "status": "shipped",
  "tracking_number": "TRACK-456"
}
```

The tool's endpoint is shown in its dashboard card. Make a request using that
URL:

```bash
curl -X POST "https://mockagent.online/api/v1/mock/YOUR_TOOL_ID" \
  -H "Content-Type: application/json" \
  -H "x-mockagent-run-id: order-test-001" \
  -d '{"order_id":"order-123"}'
```

Replace `YOUR_TOOL_ID` with the ID from the tool card. A valid request returns
the configured mock response. Invalid arguments return structured validation
details so you can correct the agent's tool call. Use a new run ID for each
independent agent run and reuse that ID for the calls within that run.

## Use the dashboard

### Mock tools, scenarios, and logs

- **Edit a tool** to update its schema, response, scenarios, or assertions.
  Edit scenarios with a guided JSON-schema matcher/response editor and preview
  an input locally (including a selected response-sequence step). Previous
  configurations are revisioned so you can compare changed fields against the
  current tool or restore a recent version.
- **Scenarios** match request arguments against JSON Schema and return a
  scenario-specific response. A scenario may return a sequence of responses
  for testing changing data or retry behavior. Sequences advance on successful
  matching calls with the same run ID; the last response repeats once the
  sequence is exhausted. For retry tests, configure optional scheduled
  transient failures (`429`, `500`, `502`, or `503`) at specific matching-call
  steps. These return structured retryable errors, honor `Retry-After`, and
  appear as **Injected Failure** in logs. Scheduled failures advance the
  scenario call step; use the same run ID across retries so failure and
  recovery are deterministic. Without a run ID, each request starts at step 1.
- **Execution Logs** show calls, validation failures, latency, responses, and
  run IDs. Replay a saved successful call to compare its result against the
  current mock configuration.
- **Endpoint protection** is configurable per tool. When API-key protection
  is enabled, create a workspace key and send it as a bearer token:

  ```http
  Authorization: Bearer YOUR_API_KEY
  ```

  API keys are shown only when created. Save the value securely; revoke it
  from workspace settings if it is lost or no longer needed.

### Agent Playground

Choose active mock tools, enter a prompt, and run the agent. MockAgent displays
the final answer, tool calls, arguments, and responses; calls also appear in
Execution Logs. The Playground can use up to 250 tools (the maximum Team plan
tool allowance), subject to a combined JSON Schema size of 32 KB. It can
continue making tool calls until the server request deadline or workspace AI
rate/monthly quota is reached; each completion counts against that quota.

Tools protected by an API key are supported. Enter the key for each selected
protected tool in the Playground before running it. The key is sent to the
matching MockAgent gateway call only; it is not included in the model prompt
and is not saved with the run or regression test. Keep keys out of prompts and
never paste them into the task text.

The Playground uses the AI model configured for the service. Prompts, tool
arguments, and mock responses are sent to that model provider. Do not include
secrets or sensitive data unless that data flow is approved.

### Meta AI Tool Studio

Describe a tool in plain language to generate a draft containing a name,
description, JSON Schema, mock response, and conditional scenarios. MockAgent
validates the generated schema and scenario matchers before showing the draft.
Review and edit the JSON, then create the tool; the normal server-side tool
validation and workspace plan limits apply again when it is saved.

Tool generation, the dashboard assistant, regression-case generation,
failure explanations, and Semantic QA use the configured Meta model provider.
For direct first-party Meta Model API access, set `MODEL_API_KEY`; MockAgent
then uses `https://api.meta.ai/v1` and `muse-spark-1.3` by default. `META_MODEL`
can select another Muse Spark or Muse Wonder text model. The Playground queries
Meta's authenticated `/models` catalog and exposes the available models in its
model selector. Model API keys stay server-side.

The Agent Playground uses Meta's Responses API for native Model API
configurations. It executes developer-defined mock tools itself, returns each
tool result to Muse, and replays encrypted reasoning items between turns with
`store: false` so conversation state is not stored by the model API. Every
model turn still consumes one workspace AI request. The Responses API provides
the tool-use loop with reasoning continuity; other Meta-powered features use
the compatible chat-completions endpoint.

For existing deployments or hosted open-weight inference, the
`SEMANTIC_JUDGE_BASE_URL`, `SEMANTIC_JUDGE_API_KEY`, and
`SEMANTIC_JUDGE_MODEL` variables remain supported as a Baseten-compatible
fallback (defaulting to Muse Spark Open). If both providers are configured,
`MODEL_API_KEY` takes precedence. Generated content is a draft and should be
reviewed before use.

### Regression tests

Create a saved regression test with one or more named prompt cases (up to 20),
selected tools, and checks for expected behavior. Available checks include:

- The exact ordered tool-call sequence.
- Required phrases in the final answer.
- JSON response fields, checked with equals, contains, exists, greater-than,
  less-than, or JSON Schema shape assertions. A schema assertion can enforce
  required fields, types, allowed values, array item shapes, and
  `additionalProperties` on a whole response or nested object. Assertions can
  target the first call or require every call to the chosen tool to pass.
- Optional semantic answer criteria evaluated against successful tool
  responses and timestamps by the configured model judge.

Run a single test or choose **Run all** to execute every saved case. Results,
checks, run IDs, and bounded traces are recorded per case. A test passes only
when its configured checks pass and its tool requests succeed. Phrase checks
are case-insensitive text matches; they do not prove an answer is factually
correct. Semantic QA adds model-based evidence checking but is also fallible
and should not be treated as proof of correctness.

Each case can make multiple model requests and consume AI usage. **Run all**
shows a confirmation first, and **Stop after current** prevents remaining
cases from starting while allowing the active case to finish.

From a saved run, replay its prompt, selected model, and regression checks with
a fresh run ID. Choose **current config** to use the workspace's current tool
definitions, or **saved config** to reuse the run's versioned schemas, mock
responses, and scenarios. Compare the new trace against the source, including
its answer, ordered tool calls, arguments, responses, statuses, model, and
provider. Branch from a run to edit the prompt, choose another model, and
select either configuration. Branches link to their source run in history.
Saved-config replay reproduces the mocked tool setup, not deterministic model
output or external systems. Runs created before tool snapshots were introduced
can only be replayed against current configuration. Existing history without a
prompt snapshot can fall back to the saved case prompt.

Applying the latest `schema.sql` adds the snapshot column and the short-lived,
service-role-only table used to authorize saved-config replays.

Use **Generate with Meta AI** in the test-case editor to draft prompt cases
from the selected tools' schemas, mock responses, and scenarios. Add an
optional focus hint; generated cases are editable and are not saved until you
review and save the regression test. From a failed saved run, choose **Explain & draft follow-up** to ask Meta for an
evidence-linked explanation and then draft follow-up cases from the failed
checks and bounded trace. Review and edit the explanation and cases; choose
**Save reviewed follow-up test** to persist a new test that retains the source
test's configured checks. This combined action makes two AI requests (one
explanation and one generation request), each subject to the workspace's normal
usage and rate limits.

Choose **Target coverage gaps** to ask Meta to prioritize arguments, enum
values, scenarios, and response-sequence steps not yet observed in the latest
100 saved regression traces for the selected tools. The generated prompts are
still drafts: only rerunning the saved cases can confirm whether they cover
those targets.

Choose **Auto-improve** on a saved test to run its baseline cases, measure
coverage for its selected tools, and ask Meta to draft cases aimed at the
uncovered arguments, enum values, scenarios, and response-sequence steps. The
loop is capped at two or three rounds. Each round shows the measured coverage
before and after its cases run, plus case outcomes and the coverage delta.
Meta's draft remains editable and is neither saved nor run until you choose
**Save & run round N**. Confirmed rounds use the same saved-test execution,
workspace quotas, and rate limits as other runs. Generated round tests do not
inherit sequence, response, or answer assertions from the baseline; add those
checks to the saved test when needed. Coverage depends on the configured
selected tools and available saved traces, so increases are measured
observations, not a guarantee of agent correctness.

Choose **Review contract risks** for an advisory Meta review of the selected
tool schemas, mock responses, scenarios, and uncovered coverage points. Each
finding includes a severity, a JSON Pointer validated against the supplied
contract, a potential failure mode, and a suggested prompt. Use **Add as
draft** to place a finding's prompt in the editable regression cases. The
review does not modify tools or prove that a risk exists; execute and inspect
the resulting test before changing a contract.

Use **Export all** to download a versioned JSON bundle. Exports reference tools
by name rather than workspace-specific IDs. **Import JSON** validates the
bundle and each suite, then asks you to map every exported tool name to an
active tool in the current workspace before saving. Imports are limited to
50 suites and 10 MB per file; if a multi-suite import has a save error, the
panel reports which suites were saved and which failed.

For a failed saved run, **Explain & draft follow-up** combines the explanation
and case drafting flow described above. The explanation uses the run's failed
checks and bounded trace, and each finding must cite an actual failed check.
Treat it as a diagnostic suggestion, not a verified root cause; inspect the
original trace before changing the test or tool.

Saved run traces show the configured model and provider. For native Meta Model
API runs, the trace also reports whether an encrypted reasoning item was
replayed between tool turns; it never displays the encrypted reasoning
contents.

Coverage and test analytics are limited to available saved regression traces.
They do not represent every tool call in the workspace or guarantee agent
correctness.

### Run the demo

Choose **Run demo** in the Regression Tests panel to see a seeded
`lookup_order` → `issue_refund` failure, Meta's evidence-based explanation and
editable regression draft, then a confirmed local rerun that checks the
pending → ready response sequence and reports coverage improvement. The
`lookup_order`, `issue_refund`, and `check_inventory` fixtures run in the
browser-side sandbox with a deterministic sample agent; the demo does not
create workspace tools or regression records, call a real business service, or
issue a refund. Only the explanation and draft are generated by Meta. That
review consumes one normal workspace AI request and is subject to the
configured provider and Free-plan quotas.

#### Run saved tests in CI

The dependency-free Node runner at
[`scripts/mockagent-ci.mjs`](./scripts/mockagent-ci.mjs) runs saved regression
cases and exits nonzero if any case fails. Create a dedicated workspace API
key in **API Keys**, set a suitable monthly call limit, and store it only as a
CI secret. The key is workspace-scoped and can also authorize calls to
protected tools in that workspace; revoke it from the dashboard if exposed.

Configure these environment variables in the CI job:

```text
MOCKAGENT_BASE_URL=https://your-mockagent-host
MOCKAGENT_API_KEY=ma_live_...
MOCKAGENT_SUITE_IDS=optional,comma,separated,suite-ids
```

`MOCKAGENT_SUITE_IDS` is optional; when omitted, all saved suites in the
workspace run. Each case executes through the saved-suite API, consuming the
workspace's normal AI and mock-call quotas. The runner writes a GitHub Actions
step summary when `GITHUB_STEP_SUMMARY` is available. A manual-run example is
provided in [`.github/workflows/mockagent-regression.yml`](./.github/workflows/mockagent-regression.yml).

Run the runner locally with `node scripts/mockagent-ci.mjs`.

### Analytics and run history

Regression analytics include pass rates, recent trends, daily results,
recurring failed checks, test reliability, model breakdowns, and average tool
calls for runs with valid traces. Analytics are calculated from the loaded
history, not automatically from every retained run. Choose **Load older runs**
to expand the history included in analytics. Regression coverage shows which
configured argument fields, enum values, named scenarios, and response steps
were observed in successful saved-test traces. Coverage is explicitly scoped
to the loaded trace history and is not a claim about all workspace traffic.
Coverage-guided generation uses a bounded recent history of up to 100 saved
traces and reports its targets as priorities, not guaranteed coverage.

### Assistant

The dashboard's MockAgent Assistant can help with ideas for tool definitions
and test cases. It is a chat helper and does not have automatic access to your
workspace data or replace an IDE coding assistant.

## Plans and usage

Usage is shared across the workspace. The dashboard's **Plan and billing**
panel shows the current plan, usage, and remaining quotas.

| Plan | Mock tool calls / month | AI requests / month | Tools | Seats | API keys | Log retention |
|---|---:|---:|---:|---:|---:|---:|
| Free | 1,000 | 100 | 3 | 1 | 2 | 7 days |
| Solo | 20,000 | 1,000 | 25 | 1 | 10 | 30 days |
| Team | 100,000 | 5,000 | 250 | 10 | 50 | 90 days |

Each model completion counts as one AI request, including each tool-calling
turn in a Playground run. A shared limit allows up to 10 AI requests per
workspace per minute. Tool requests are also subject to gateway rate limits.
Monthly quotas reset on the UTC month boundary. Calls that reach a quota are
blocked until the quota resets or the workspace changes plan.

Workspace owners and admins can manage members, API keys, and log retention.
Paid checkout and subscription management depend on the deployment's Dodo
Payments configuration (API key, webhook key, environment, and plan product
IDs), plus the provider returning a valid checkout session. Availability of
live billing is deployment-specific; do not assume checkout is enabled on
every instance.

## Use the API and SDKs

Each mock tool has a public HTTPS endpoint:

```text
POST https://mockagent.online/api/v1/mock/{toolId}
```

Send a JSON object as the request body. Include `x-mockagent-run-id` to
associate calls from one agent run and enable run-level assertions. A `GET`
request to the endpoint returns the tool schema and description.

The JavaScript/TypeScript SDK is published as [`trymockagent`](https://www.npmjs.com/package/trymockagent):

```bash
npm install trymockagent
```

```js
import { MockAgent } from "trymockagent";

const mock = new MockAgent({ toolId: "YOUR_TOOL_ID" });
const result = await mock.call(
  { order_id: "order-123" },
  { runId: "order-test-001" },
);
```

The Python SDK is available in the
[`packages/mockagent-python`](./packages/mockagent-python) source directory;
it has not been published to PyPI. Use the HTTP API directly if you prefer not
to install from source.

### Real-agent and CI example

The [delayed-order refund example](./examples/delayed-order-refund/README.md)
uses the published JavaScript SDK to call MockAgent tools. Run the `--buggy`
mode to reproduce a pending-order refund regression (exit code `1`), then run
the corrected flow. The example README includes tool setup, local SDK tests,
and a CI snippet.

The saved-suite runner
([`scripts/mockagent-ci.mjs`](./scripts/mockagent-ci.mjs)) exits nonzero when a
saved check fails. The manual GitHub Actions workflow
([`.github/workflows/mockagent-regression.yml`](./.github/workflows/mockagent-regression.yml))
shows how to run it with workspace secrets and optional suite IDs.

## Safety and data handling

MockAgent validates and records requests sent to mock endpoints. Logs, test
prompts, traces, and mock responses may contain the data you send. Keep
credentials and sensitive personal or production data out of prompts and test
payloads, and review retained logs according to your workspace's data
requirements. API keys are displayed only once; store them securely and
revoke keys that are no longer in use.

## Self-hosting

This repository contains the MockAgent application. To run your own instance,
configure Supabase, Upstash rate limiting, the model provider, and—if needed—
Dodo Payments using [`.env.example`](./.env.example). Apply [`schema.sql`](./schema.sql)
to your Supabase project before using the app. Reapply it to existing
deployments to update the logs status constraint for scheduled
`INJECTED_FAILURE` entries. Before deploying, run:

```bash
npm install
npm test
npm run check:config
npm run build
```

The configuration check validates environment-variable presence and format;
it does not apply or exercise a live database migration, model provider, or
payment checkout. Test those integrations in their respective test
environments before enabling them for users.

## Support

Visit [mockagent.online](https://mockagent.online) to create an account or log
in. For self-hosting and technical issues, open an issue in the
[GitHub repository](https://github.com/shauryasjadaunnn12345/Mockagent/issues).
