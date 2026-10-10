import assert from "node:assert/strict";
import test from "node:test";
import { MockAgent, MockAgentError } from "./index.mjs";

test("call sends JSON, bearer key, and run ID", async () => {
  let request;
  const client = new MockAgent({
    toolId: "tool id",
    apiKey: "secret",
    fetch: async (url, options) => {
      request = { url, options };
      return new Response('{"ok":true}', { status: 200 });
    },
  });

  assert.deepEqual(await client.call({ value: 1 }, { runId: "run-1" }), { ok: true });
  assert.equal(request.url, "https://mockagent.online/api/v1/mock/tool%20id");
  assert.equal(request.options.headers.authorization, "Bearer secret");
  assert.equal(request.options.headers["x-mockagent-run-id"], "run-1");
  assert.equal(request.options.headers["content-type"], "application/json");
  assert.equal(request.options.body, '{"value":1}');
});

test("HTTP errors preserve structured error and retry guidance", async () => {
  const client = new MockAgent({
    toolId: "tool",
    fetch: async () => new Response(
      '{"error":"Try again","retryable":true}',
      { status: 429, headers: { "Retry-After": "3" } },
    ),
  });

  await assert.rejects(client.call({}), (error) => {
    assert.ok(error instanceof MockAgentError);
    assert.equal(error.status, 429);
    assert.equal(error.retryable, true);
    assert.equal(error.retryAfterSeconds, 3);
    assert.deepEqual(error.body, { error: "Try again", retryable: true });
    return true;
  });
});

test("final-answer submission requires and forwards the run ID", async () => {
  let request;
  const client = new MockAgent({
    toolId: "tool",
    fetch: async (_url, options) => {
      request = options;
      return new Response('{"passed":true}', { status: 200 });
    },
  });

  await assert.rejects(client.submitFinalAnswer("done"), TypeError);
  assert.deepEqual(await client.submitFinalAnswer("done", { runId: "run-2" }), { passed: true });
  assert.equal(request.headers["x-mockagent-run-id"], "run-2");
  assert.equal(request.body, '{"final_answer":"done"}');
});
