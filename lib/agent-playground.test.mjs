import assert from "node:assert/strict";
import test from "node:test";
import {
  getPlaygroundFunctionName,
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
