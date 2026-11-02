import assert from "node:assert/strict";
import test from "node:test";
import {
  getPlaygroundFunctionName,
  parsePlaygroundApiKeys,
  parsePlaygroundArguments,
} from "./agent-playground.ts";

test("creates model-safe names that map to a tool id", () => {
  assert.equal(
    getPlaygroundFunctionName("a42e11c5-1234-4abc-8def-123456789012"),
    "mock_a42e11c5-1234-4abc-8def-123456789012",
  );
  assert.equal(getPlaygroundFunctionName("tool with spaces"), "mock_toolwithspaces");
});

test("parses object arguments", () => {
  assert.deepEqual(parsePlaygroundArguments('{"order_id":"A-1"}'), {
    success: true,
    arguments: { order_id: "A-1" },
  });
});

test("rejects malformed or non-object arguments", () => {
  assert.deepEqual(parsePlaygroundArguments("{"), {
    success: false,
    error: "Tool arguments were not valid JSON.",
  });
  assert.deepEqual(parsePlaygroundArguments("[]"), {
    success: false,
    error: "Tool arguments must be a JSON object.",
  });
  assert.deepEqual(parsePlaygroundArguments("null"), {
    success: false,
    error: "Tool arguments must be a JSON object.",
  });
});

test("accepts ephemeral API keys only for selected tools that require authentication", () => {
  const tools = [
    { id: "protected", name: "lookup", require_api_key: true },
    { id: "public", name: "public lookup", require_api_key: false },
  ];
  assert.deepEqual(parsePlaygroundApiKeys({ protected: "ma_live_testkey" }, tools), {
    success: true,
    apiKeys: { protected: "ma_live_testkey" },
  });
  assert.equal(parsePlaygroundApiKeys({}, tools).success, false);
  assert.equal(parsePlaygroundApiKeys({ unknown: "secret" }, tools).success, false);
  assert.equal(parsePlaygroundApiKeys({ public: "secret" }, tools).success, false);
  assert.equal(parsePlaygroundApiKeys({ protected: "bad key" }, tools).success, false);
});
