# MockAgent

**Test the tool calls your AI agent has not made yet.**

[MockAgent](https://mockagent.online) gives you predictable mock endpoints for
agent tools, so you can validate inputs, exercise edge cases, and inspect agent
behavior without connecting to real services or triggering real side effects.

**[Open MockAgent](https://mockagent.online)** · [Create an account](https://mockagent.online/login?mode=signup) · [Log in](https://mockagent.online/login?mode=login)

## What you can do

- **Create mock tools** with a name, description, JSON Schema argument
  contract, and deterministic JSON response.
- **Test alternate outcomes** with conditional scenarios and ordered response
  sequences—useful for retries, stale data, and edge cases.
- **Run an AI agent against your tools** in the Agent Playground and inspect
  the model's answer and every tool call.
- **Build repeatable regression tests** with named prompt cases, expected tool
  calls, answer checks, and assertions against JSON response fields.
- **Understand changes and failures** with execution logs, schema validation
  errors, run traces, replay comparisons, and regression analytics.
- **Control access and usage** with bearer API keys, shared workspaces, plan
  quotas, and log retention settings.

## Get started

1. **Create an account** at [mockagent.online](https://mockagent.online) and
   open your workspace.
2. Select **New Mock Tool** and provide a tool name, description, expected
   JSON Schema, and mock response. Add conditional scenarios if different
   inputs should return different results.
3. Save the tool. Its card shows the endpoint URL and the matching tool
   definition for your agent.
4. Send a test call to the endpoint, or select the tool in the Agent Playground.
5. Inspect the result in Execution Logs, then refine the schema, response, or
   scenarios and run it again.

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
  Previous configurations are revisioned so you can review or restore a
  recent version.
- **Scenarios** match request arguments against JSON Schema and return a
  scenario-specific response. A scenario may return a sequence of responses
  for testing changing data or retry behavior. Sequences advance on successful
  matching calls with the same run ID; the last response repeats once the
  sequence is exhausted.
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
Execution Logs. The Playground can use up to eight selected tools and makes
up to five tool calls per run. Tools protected by an API key are not available
in the Playground.

The Playground uses the AI model configured for the service. Prompts, tool
arguments, and mock responses are sent to that model provider. Do not include
secrets or sensitive data unless that data flow is approved.

### Regression tests

Create a saved regression test with one or more named prompt cases (up to 20),
selected tools, and checks for expected behavior. Available checks include:

- The exact ordered tool-call sequence.
- Required phrases in the final answer.
- JSON response fields, checked with equals, contains, exists, greater-than,
  or less-than assertions.

Run a single test or choose **Run all** to execute every saved case. Results,
checks, run IDs, and bounded traces are recorded per case. A test passes only
when its configured checks pass and its tool requests succeed. Phrase checks
are case-insensitive text matches; they do not prove an answer is factually
correct.

Each case can make multiple model requests and consume AI usage. **Run all**
shows a confirmation first, and **Stop after current** prevents remaining
cases from starting while allowing the active case to finish.

### Analytics and run history

Regression analytics include pass rates, recent trends, daily results,
recurring failed checks, test reliability, model breakdowns, and average tool
calls for runs with valid traces. Analytics are calculated from the loaded
history, not automatically from every retained run. Choose **Load older runs**
to expand the history included in analytics.

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
Paid plan checkout and subscription management are available from the billing
panel when enabled for the workspace.

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
to your Supabase project before using the app. Before deploying, run:

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
