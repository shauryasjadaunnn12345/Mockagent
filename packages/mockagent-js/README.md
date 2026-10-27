# trymockagent

The JavaScript and TypeScript client for [MockAgent](https://mockagent.online).
Call mock tools, associate calls with an agent run, and submit final answers for
configured QA checks.

## Requirements

- Node.js 18 or later
- A MockAgent tool ID

## Installation

```bash
npm install trymockagent
```

## Quick start

```typescript
import { randomUUID } from "node:crypto";
import { MockAgent, MockAgentError } from "trymockagent";

const mock = new MockAgent({
  toolId: process.env.MOCKAGENT_TOOL_ID!,
  // Set this only when your tool requires an API key.
  apiKey: process.env.MOCKAGENT_API_KEY,
});

const runId = randomUUID();

try {
  const result = await mock.call(
    { user_id: "vip", reason: "duplicate" },
    { runId },
  );
  console.log(result);
} catch (error: unknown) {
  if (error instanceof MockAgentError) {
    console.error({
      status: error.status,
      body: error.body,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }
  throw error;
}
```

`call()` returns a `Promise<JsonValue>`. Its argument must be JSON-compatible.
The SDK does not retry automatically; use the error's retry guidance to decide
whether and when your application should retry.

## Configuration

`MockAgent` accepts these options:

| Option | Type | Required | Description |
| --- | --- | --- | --- |
| `toolId` | `string` | Yes | ID of the MockAgent tool to call. |
| `apiKey` | `string` | No | API key sent as a bearer token when the tool requires authentication. |
| `baseUrl` | `string` | No | MockAgent origin. Defaults to `https://mockagent.online`. Set this for a self-hosted instance. |
| `fetch` | `typeof globalThis.fetch` | No | Fetch implementation; defaults to the runtime's global `fetch`. |

For example, to specify an API origin explicitly:

```typescript
const mock = new MockAgent({
  toolId: process.env.MOCKAGENT_TOOL_ID!,
  baseUrl: "https://mockagent.online",
});
```

Keep API keys on the server and do not expose them in browser code.

## API

### `new MockAgent(options)`

Creates a client for one tool. Throws `TypeError` if `toolId` is missing or no
Fetch API implementation is available.

### `mock.getTool()`

Fetches the tool's schema and description.

```typescript
const tool: unknown = await mock.getTool();
```

The return type is `Promise<unknown>` because the tool metadata is returned by
the API without a more specific SDK type.

### `mock.call(arguments, options?)`

Posts JSON arguments to the tool and returns the configured JSON response.
Optionally include a run ID; reuse the same ID across tool calls made during
one run.

```typescript
const runId = randomUUID();
const result = await mock.call(
  { user_id: "vip", reason: "duplicate" },
  { runId },
);
```

The argument type is `JsonValue`, and the return type is `Promise<JsonValue>`.
When supplied, `runId` is sent in the `x-mockagent-run-id` request header.

### `mock.submitFinalAnswer(finalAnswer, { runId })`

Submits an agent's final text for configured final-answer QA. The run ID is
required and must match the ID used for that run's tool calls.

```typescript
const qa: unknown = await mock.submitFinalAnswer(
  "The VIP refund was processed.",
  { runId },
);
console.log(qa);
```

The return type is `Promise<unknown>` because the API response includes
tool-configured QA results. Configure at least one answer QA criterion for the
tool before calling this method; otherwise the API responds with HTTP 409.

### `MockAgentError`

HTTP failures and non-JSON responses are thrown as `MockAgentError`. It extends
`Error` and exposes:

| Property | Type | Description |
| --- | --- | --- |
| `status` | `number \| null` | HTTP status, or `null` if there was no HTTP response. |
| `body` | `unknown` | Parsed response body, or response text for a non-JSON response. |
| `retryable` | `boolean \| null` | Retry guidance from the API response, if provided. |
| `retryAfterSeconds` | `number \| null` | Parsed `Retry-After` header, if provided. |

Import it explicitly when using `instanceof`:

```typescript
import { MockAgentError } from "trymockagent";
```

## TypeScript

The package includes TypeScript declarations. `JsonValue`, `MockAgentOptions`,
`CallOptions`, `MockAgent`, and `MockAgentError` are exported from the package
entry point.

## License

MIT. See [LICENSE](./LICENSE).
