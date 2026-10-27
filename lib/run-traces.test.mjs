import assert from "node:assert/strict";
import test from "node:test";
import {
  compareRunTraces,
  createRunTrace,
  MAX_TRACE_RESPONSE_LENGTH,
} from "./run-traces.ts";

const call = {
  toolId: "tool-1",
  toolName: "lookup_order",
  arguments: { order_id: "A-1" },
  response: { status: "found" },
  status: 200,
};

test("creates a compact trace from calls and answer", () => {
  assert.deepEqual(createRunTrace("Order found.", [call]), {
    answer: "Order found.",
    calls: [{
      toolId: "tool-1",
      toolName: "lookup_order",
      arguments: '{"order_id":"A-1"}',
      response: '{"status":"found"}',
      status: 200,
    }],
  });
});

test("bounds large run values before persistence", () => {
  const trace = createRunTrace("answer", [{
    ...call,
    response: "x".repeat(MAX_TRACE_RESPONSE_LENGTH * 2),
  }]);
  assert.ok(trace.calls[0].response.length <= MAX_TRACE_RESPONSE_LENGTH + 80);
  assert.match(trace.calls[0].response, /\[truncated; \d+ chars, fingerprint \d+\]$/);
});

test("detects changes beyond the stored response preview", () => {
  const prefix = "x".repeat(MAX_TRACE_RESPONSE_LENGTH + 100);
  const before = createRunTrace("answer", [{ ...call, response: `${prefix}a` }]);
  const after = createRunTrace("answer", [{ ...call, response: `${prefix}b` }]);
  assert.equal(compareRunTraces(before, after)[0].label, "Call 1 response");
});

test("compares answers, call counts, arguments, status, and response", () => {
  const before = createRunTrace("before", [call]);
  const after = createRunTrace("after", [
    { ...call, arguments: { order_id: "B-2" }, response: { status: "missing" }, status: 404 },
    { ...call, toolId: "tool-2", toolName: "refund_order" },
  ]);
  assert.deepEqual(compareRunTraces(before, after).map((difference) => difference.label), [
    "Final answer",
    "Tool call count",
    "Call 1 arguments",
    "Call 1 HTTP status",
    "Call 1 response",
    "Call 2 tool",
  ]);
});

test("returns no differences for identical traces", () => {
  const trace = createRunTrace("same", [call]);
  assert.deepEqual(compareRunTraces(trace, trace), []);
});
