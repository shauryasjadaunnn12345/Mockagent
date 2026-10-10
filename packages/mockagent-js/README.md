# trymockagent

Small JavaScript/TypeScript client for calling MockAgent mock tools and
submitting final answers for configured QA checks. Requires Node.js 18+.

After publishing the package, install it with:

```bash
npm install trymockagent
```

```js
import { randomUUID } from "node:crypto";
import { MockAgent } from "trymockagent";

const mock = new MockAgent({
  toolId: "YOUR_TOOL_ID",
  apiKey: process.env.MOCKAGENT_API_KEY, // optional unless the tool requires a key
});

const runId = randomUUID();
try {
  const result = await mock.call({ user_id: "vip", reason: "duplicate" }, { runId });
  console.log(result);
  // If this tool has final-answer QA criteria configured:
  const qa = await mock.submitFinalAnswer("The VIP refund was processed.", { runId });
  console.log(qa);
} catch (error) {
  if (error instanceof MockAgentError) {
    console.error(error.status, error.body, error.retryable, error.retryAfterSeconds);
  }
  throw error;
}
```

`getTool()` fetches the tool's schema and description. `call(arguments, { runId })`
posts the arguments as JSON and forwards the run ID in `x-mockagent-run-id`.
`submitFinalAnswer(text, { runId })` submits final-answer checks for that run.
No automatic retries are made; inspect `MockAgentError` and follow the response's
retry guidance. Set `baseUrl` when using a self-hosted MockAgent instance.
