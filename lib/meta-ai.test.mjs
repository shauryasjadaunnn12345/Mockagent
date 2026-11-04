import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeDemoFailure,
  getMetaConfig,
  hasEncryptedReasoningItem,
  listMetaModels,
  metaChatCompletion,
  metaResponsesCompletion,
  readMetaFunctionCalls,
} from "./meta-ai.ts";

const originalEnv = {
  modelApiKey: process.env.MODEL_API_KEY,
  metaModel: process.env.META_MODEL,
  metaBaseUrl: process.env.META_MODEL_API_BASE_URL,
  basetenKey: process.env.SEMANTIC_JUDGE_API_KEY,
  basetenModel: process.env.SEMANTIC_JUDGE_MODEL,
  basetenBaseUrl: process.env.SEMANTIC_JUDGE_BASE_URL,
  geminiKey: process.env.GEMINI_API_KEY,
  geminiModel: process.env.GEMINI_MODEL,
};
const originalFetch = globalThis.fetch;

function setEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function useNativeProvider() {
  process.env.MODEL_API_KEY = "test-meta-key";
  process.env.META_MODEL = "muse-spark-1.3";
  process.env.META_MODEL_API_BASE_URL = "https://api.meta.ai/v1";
  delete process.env.SEMANTIC_JUDGE_API_KEY;
  delete process.env.SEMANTIC_JUDGE_MODEL;
  delete process.env.SEMANTIC_JUDGE_BASE_URL;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_MODEL;
}

test.after(() => {
  setEnv("MODEL_API_KEY", originalEnv.modelApiKey);
  setEnv("META_MODEL", originalEnv.metaModel);
  setEnv("META_MODEL_API_BASE_URL", originalEnv.metaBaseUrl);
  setEnv("SEMANTIC_JUDGE_API_KEY", originalEnv.basetenKey);
  setEnv("SEMANTIC_JUDGE_MODEL", originalEnv.basetenModel);
  setEnv("SEMANTIC_JUDGE_BASE_URL", originalEnv.basetenBaseUrl);
  setEnv("GEMINI_API_KEY", originalEnv.geminiKey);
  setEnv("GEMINI_MODEL", originalEnv.geminiModel);
  globalThis.fetch = originalFetch;
});

test("prefers native Meta Model API and supports Baseten as a backwards-compatible provider", () => {
  useNativeProvider();
  assert.deepEqual(getMetaConfig(), {
    apiKey: "test-meta-key",
    model: "muse-spark-1.3",
    baseUrl: "https://api.meta.ai/v1",
    provider: "meta-model-api",
    configured: true,
  });

  delete process.env.MODEL_API_KEY;
  process.env.SEMANTIC_JUDGE_API_KEY = "test-baseten-key";
  assert.equal(getMetaConfig().provider, "baseten");
  assert.equal(getMetaConfig().model, "meta-models/muse-spark-open-1026");
});

test("lists available Muse text models from the first-party model catalog", async () => {
  useNativeProvider();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.meta.ai/v1/models");
    assert.equal(init?.method, "GET");
    assert.match(new Headers(init?.headers).get("Authorization") ?? "", /^Bearer /);
    return Response.json({
      data: [
        { id: "muse-spark-1.3" },
        { id: "muse-wonder-1.0" },
        { id: "muse-image-1.0" },
        { id: "unrelated-model" },
      ],
    });
  };
  assert.deepEqual(await listMetaModels(), ["muse-spark-1.3", "muse-wonder-1.0"]);
});

test("uses Meta Responses API with stateless encrypted reasoning replay and flat tools", async () => {
  useNativeProvider();
  let requestBody;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.meta.ai/v1/responses");
    assert.match(new Headers(init?.headers).get("Authorization") ?? "", /^Bearer /);
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      id: "resp_test",
      model: "muse-spark-1.3",
      output_text: "Done.",
      output: [{ type: "message", content: [{ type: "output_text", text: "Done." }] }],
    });
  };
  const result = await metaResponsesCompletion({
    instructions: "Use tools safely.",
    input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
    tools: [{
      type: "function",
      name: "lookup_order",
      description: "Lookup order.",
      parameters: { type: "object", properties: {} },
    }],
  });
  assert.equal(requestBody.model, "muse-spark-1.3");
  assert.equal(requestBody.store, false);
  assert.deepEqual(requestBody.include, ["reasoning.encrypted_content"]);
  assert.equal(requestBody.tools[0].name, "lookup_order");
  assert.equal(result.outputText, "Done.");
});

test("normalizes native tool calls and rejects malformed tool outputs", () => {
  assert.deepEqual(readMetaFunctionCalls([
    { type: "reasoning", summary: [] },
    { type: "function_call", call_id: "call_1", name: "lookup_order", arguments: "{\"id\":\"1\"}" },
  ]), [{
    id: "call_1",
    function: { name: "lookup_order", arguments: "{\"id\":\"1\"}" },
  }]);
  assert.equal(readMetaFunctionCalls([
    { type: "function_call", call_id: "call_1", name: "lookup_order" },
  ]), null);
});

test("detects encrypted reasoning without exposing its contents", () => {
  assert.equal(hasEncryptedReasoningItem([
    { type: "reasoning", encrypted_content: "opaque-token" },
  ]), true);
  assert.equal(hasEncryptedReasoningItem([
    { type: "reasoning", summary: [] },
    { type: "message", content: [] },
  ]), false);
  assert.equal(hasEncryptedReasoningItem([{ type: "reasoning", encrypted_content: "" }]), false);
});

test("sends the demo failure review through the configured Meta model", async () => {
  useNativeProvider();
  let requestBody;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.meta.ai/v1/chat/completions");
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: "The agent attempted a refund before checking the ready status.",
            findings: [{ checkName: "No refund attempt while the order is pending", explanation: "The trace shows a refund call after a pending status.", suggestedAction: "Re-check the order status before refunding." }],
            test_cases: [{ name: "Wait for ready status", prompt: "Check the latest order status before refunding." }],
          }),
        },
      }],
    });
  };
  const result = await analyzeDemoFailure({
    flawedAgentPrompt: "Immediately refund delayed orders.",
    tools: [],
    failedCheckName: "No refund attempt while the order is pending",
    trace: { calls: [] },
  });
  assert.equal(requestBody.model, "muse-spark-1.3");
  assert.equal(requestBody.response_format.type, "json_object");
  assert.match(requestBody.messages[0].content, /follow-up regression case/);
  assert.equal(result.test_cases[0].name, "Wait for ready status");
});

test("retries the demo through Gemini when the native Meta API rate-limits", async () => {
  useNativeProvider();
  process.env.SEMANTIC_JUDGE_API_KEY = "test-baseten-key";
  process.env.SEMANTIC_JUDGE_MODEL = "meta-models/muse-spark-open-1026";
  process.env.GEMINI_API_KEY = "test-gemini-key";
  let requestCount = 0;
  let fallbackProvider = null;
  let fallbackModel = null;
  globalThis.fetch = async (url, init) => {
    requestCount += 1;
    if (requestCount === 1) {
      assert.equal(String(url), "https://api.meta.ai/v1/chat/completions");
      return new Response("rate limited", { status: 429 });
    }

    assert.equal(String(url), "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    assert.match(new Headers(init?.headers).get("Authorization") ?? "", /^Bearer test-gemini-key$/);
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "gemini-3.8-flash");
    return Response.json({
      choices: [{
        message: {
          content: JSON.stringify({
            summary: "The agent attempted a refund before checking the ready status.",
            findings: [{
              checkName: "No refund attempt while the order is pending",
              explanation: "The trace shows a refund call after a pending status.",
              suggestedAction: "Re-check the order status before refunding.",
            }],
            test_cases: [{
              name: "Wait for ready status",
              prompt: "Check the latest order status before refunding.",
            }],
          }),
        },
      }],
    });
  };

  const result = await analyzeDemoFailure({
    flawedAgentPrompt: "Immediately refund delayed orders.",
    tools: [],
    failedCheckName: "No refund attempt while the order is pending",
    trace: { calls: [] },
  }, {
    onProviderFallback: (provider, model) => {
      fallbackProvider = provider;
      fallbackModel = model;
    },
  });

  assert.equal(requestCount, 2);
  assert.equal(fallbackProvider, "Gemini");
  assert.equal(fallbackModel, "gemini-3.8-flash");
  assert.equal(result.test_cases[0].name, "Wait for ready status");
});

test("routes centralized chat-completion features through native Meta API", async () => {
  useNativeProvider();
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), "https://api.meta.ai/v1/chat/completions");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, "muse-spark-1.3");
    return Response.json({ choices: [{ message: { content: "{\"ok\":true}" } }] });
  };
  const response = await metaChatCompletion({
    messages: [{ role: "user", content: "Return JSON." }],
    jsonMode: true,
  });
  assert.equal(response.choices[0].message.content, "{\"ok\":true}");
});

test("sends coverage gaps to Meta when generating regression cases", async () => {
  useNativeProvider();
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.match(body.messages[0].content, /When coverageTargets are supplied, prioritize realistic user prompts/);
    assert.deepEqual(JSON.parse(body.messages[1].content).coverageTargets, [{
      toolName: "lookup_order",
      target: 'Exercise tier = "vip"',
    }]);
    return Response.json({
      choices: [{
        message: { content: JSON.stringify({
          test_cases: [{ name: "VIP order", prompt: "Check VIP order 42." }],
        }) },
      }],
    });
  };
  const { generateRegressionTestCases } = await import("./meta-ai.ts");
  const generated = await generateRegressionTestCases({
    tools: [{
      name: "lookup_order",
      description: "Look up an order.",
      json_schema: { type: "object" },
      mock_response: {},
      scenarios: [],
    }],
    hint: "",
    coverageTargets: [{
      toolName: "lookup_order",
      target: 'Exercise tier = "vip"',
    }],
  });
  assert.equal(generated.test_cases[0].name, "VIP order");
});

test("sends tool contracts and coverage points to Meta for risk review", async () => {
  useNativeProvider();
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.match(body.messages[0].content, /practical agent-testing risks/);
    const reviewInput = JSON.parse(body.messages[1].content);
    assert.equal(reviewInput.tools[0].name, "lookup_order");
    assert.deepEqual(reviewInput.coverageTargets, [{
      toolName: "lookup_order",
      target: 'Exercise status = "unknown"',
    }]);
    return Response.json({
      choices: [{
        message: { content: JSON.stringify({
          summary: "One uncovered contract edge deserves a test.",
          findings: [],
        }) },
      }],
    });
  };
  const { reviewRegressionContracts } = await import("./meta-ai.ts");
  const review = await reviewRegressionContracts({
    tools: [{
      name: "lookup_order",
      description: "Find an order.",
      json_schema: { type: "object" },
      mock_response: { status: "shipped" },
      scenarios: [],
    }],
    coverageTargets: [{
      toolName: "lookup_order",
      target: 'Exercise status = "unknown"',
    }],
  });
  assert.deepEqual(review.findings, []);
});
