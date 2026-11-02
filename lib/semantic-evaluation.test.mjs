import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSemanticAnswer } from "./semantic-evaluation.ts";

test("judges a final answer against timestamped tool evidence", async () => {
  const previousEnvironment = {
    apiKey: process.env.SEMANTIC_JUDGE_API_KEY,
    model: process.env.SEMANTIC_JUDGE_MODEL,
    baseUrl: process.env.SEMANTIC_JUDGE_BASE_URL,
  };
  const previousFetch = globalThis.fetch;
  process.env.SEMANTIC_JUDGE_API_KEY = "test-key";
  process.env.SEMANTIC_JUDGE_MODEL = "test-model";
  process.env.SEMANTIC_JUDGE_BASE_URL = "https://judge.example/v1";
  let requestUrl = "";
  let requestBody = "";
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ passed: true, rationale: "The answer matches the latest status." }),
        },
      }],
    }), { status: 200 });
  };

  try {
    const result = await evaluateSemanticAnswer(
      "Use the latest order status.",
      "The order has shipped.",
      [{
        created_at: "2026-10-28T00:00:00.000Z",
        response_body: { status: "shipped" },
        scenario_name: null,
        scenario_step: null,
      }],
    );
    assert.deepEqual(result, {
      status: "passed",
      passed: true,
      rationale: "The answer matches the latest status.",
    });
    assert.equal(requestUrl, "https://judge.example/v1/chat/completions");
    const body = JSON.parse(requestBody);
    assert.equal(body.model, "test-model");
    assert.match(body.messages[1].content, /2026-10-28T00:00:00.000Z/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnvironment.apiKey === undefined) delete process.env.SEMANTIC_JUDGE_API_KEY;
    else process.env.SEMANTIC_JUDGE_API_KEY = previousEnvironment.apiKey;
    if (previousEnvironment.model === undefined) delete process.env.SEMANTIC_JUDGE_MODEL;
    else process.env.SEMANTIC_JUDGE_MODEL = previousEnvironment.model;
    if (previousEnvironment.baseUrl === undefined) delete process.env.SEMANTIC_JUDGE_BASE_URL;
    else process.env.SEMANTIC_JUDGE_BASE_URL = previousEnvironment.baseUrl;
  }
});

test("uses the Baseten hackathon model when optional judge settings are omitted", async () => {
  const previousEnvironment = {
    apiKey: process.env.SEMANTIC_JUDGE_API_KEY,
    model: process.env.SEMANTIC_JUDGE_MODEL,
    baseUrl: process.env.SEMANTIC_JUDGE_BASE_URL,
  };
  const previousFetch = globalThis.fetch;
  process.env.SEMANTIC_JUDGE_API_KEY = "test-key";
  delete process.env.SEMANTIC_JUDGE_MODEL;
  delete process.env.SEMANTIC_JUDGE_BASE_URL;
  let requestUrl = "";
  let requestBody = "";
  globalThis.fetch = async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body);
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({ passed: true, rationale: "Evidence supports the answer." }),
        },
      }],
    }), { status: 200 });
  };

  try {
    const result = await evaluateSemanticAnswer(
      "Use the tool output.",
      "The order shipped.",
      [{
        created_at: "2026-10-28T00:00:00.000Z",
        response_body: { status: "shipped" },
        scenario_name: null,
        scenario_step: null,
      }],
    );
    assert.equal(result.status, "passed");
    assert.equal(requestUrl, "https://inference.baseten.co/v1/chat/completions");
    assert.equal(JSON.parse(requestBody).model, "meta-models/muse-spark-open-1026");
  } finally {
    globalThis.fetch = previousFetch;
    if (previousEnvironment.apiKey === undefined) delete process.env.SEMANTIC_JUDGE_API_KEY;
    else process.env.SEMANTIC_JUDGE_API_KEY = previousEnvironment.apiKey;
    if (previousEnvironment.model === undefined) delete process.env.SEMANTIC_JUDGE_MODEL;
    else process.env.SEMANTIC_JUDGE_MODEL = previousEnvironment.model;
    if (previousEnvironment.baseUrl === undefined) delete process.env.SEMANTIC_JUDGE_BASE_URL;
    else process.env.SEMANTIC_JUDGE_BASE_URL = previousEnvironment.baseUrl;
  }
});

test("returns a clear semantic error when a run has no successful tool evidence", async () => {
  const result = await evaluateSemanticAnswer("Use evidence.", "The answer.", []);
  assert.equal(result.status, "error");
  assert.equal(result.passed, null);
  assert.match(result.rationale, /No successful tool outputs/);
});
