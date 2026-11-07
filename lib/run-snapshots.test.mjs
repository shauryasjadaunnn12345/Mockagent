import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRunToolSnapshot,
  assertRunToolSnapshotBundle,
  createRunToolSnapshotBundle,
  MAX_RUN_TOOL_SNAPSHOT_BYTES,
} from "./run-snapshots.ts";

const tool = (overrides = {}) => ({
  id: "tool-1",
  name: "lookup_order",
  description: "Look up an order",
  json_schema: {
    type: "object",
    properties: { order_id: { type: "string" } },
    required: ["order_id"],
    additionalProperties: false,
  },
  mock_response: { status: "ready" },
  scenarios: [],
  updated_at: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

test("creates and validates a versioned snapshot for the selected tools", () => {
  const bundle = createRunToolSnapshotBundle([tool()]);
  assert.equal(bundle.version, 1);
  assert.deepEqual(bundle.tools.map(({ id }) => id), ["tool-1"]);
  assert.doesNotThrow(() => assertRunToolSnapshotBundle(bundle, ["tool-1"]));
});

test("rejects snapshots that do not exactly match the selected tool IDs", () => {
  const bundle = createRunToolSnapshotBundle([tool()]);
  assert.throws(() => assertRunToolSnapshotBundle(bundle, ["tool-2"]), /does not match|missing/i);
  assert.throws(
    () => createRunToolSnapshotBundle([tool(), tool()]),
    /unique|selected tools/i,
  );
});

test("rejects oversized snapshots before persistence", () => {
  assert.throws(
    () => createRunToolSnapshotBundle([tool({ description: "x".repeat(MAX_RUN_TOOL_SNAPSHOT_BYTES) })]),
    /256 KB or smaller/,
  );
});

test("overlays historical configuration while retaining current access metadata", () => {
  const savedAssertions = [{
    name: "Require refund confirmation",
    type: "call_guard",
    path: "/confirmed",
    operator: "equals",
    value: true,
    message: "Refunds require explicit confirmation.",
  }];
  const savedTool = tool({
    name: "old_lookup_order",
    description: "Historical description",
    mock_response: { status: "pending" },
    scenarios: [{ name: "pending", match: { type: "object" }, response: { status: "pending" } }],
    final_answer_assertions: savedAssertions,
  });
  const currentTool = {
    ...tool(),
    name: "new_lookup_order",
    require_api_key: true,
    is_active: true,
  };
  const [replayedTool] = applyRunToolSnapshot(
    [currentTool],
    createRunToolSnapshotBundle([savedTool]),
  );

  assert.equal(replayedTool.name, "old_lookup_order");
  assert.deepEqual(replayedTool.mock_response, { status: "pending" });
  assert.deepEqual(replayedTool.final_answer_assertions, savedAssertions);
  assert.equal(replayedTool.require_api_key, true);
  assert.equal(replayedTool.is_active, true);
});

test("rejects invalid historical schemas and scenarios", () => {
  assert.throws(
    () => createRunToolSnapshotBundle([tool({ json_schema: { type: "unknown" } })]),
    /invalid schema/i,
  );
  assert.throws(
    () => createRunToolSnapshotBundle([tool({ scenarios: [{ name: "invalid" }] })]),
    /invalid scenarios/i,
  );
});
