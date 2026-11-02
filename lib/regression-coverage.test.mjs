import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeRegressionCoverage,
  prioritizeRegressionCoverageGaps,
} from "./regression-coverage.ts";

const tools = [{
  id: "orders",
  name: "lookup_order",
  json_schema: {
    type: "object",
    properties: {
      order_id: { type: "string" },
      tier: { type: "string", enum: ["standard", "vip"] },
    },
    required: ["order_id"],
  },
  scenarios: [{
    name: "VIP",
    match: { type: "object", properties: { tier: { const: "vip" } }, required: ["tier"] },
    responses: [{ state: "pending" }, { state: "ready" }],
  }],
}];

function run(args, response, status = 200) {
  return { trace: { calls: [{
    toolId: "orders",
    arguments: JSON.stringify(args),
    response: JSON.stringify(response),
    status,
  }] } };
}

test("measures fields, enum values, scenario matches, and observed sequence steps", () => {
  const result = analyzeRegressionCoverage(tools, [
    run({ order_id: "1", tier: "vip" }, { state: "ready" }),
    run({ order_id: "2", tier: "standard" }, { state: "default" }),
  ]);
  assert.equal(result.invalidToolConfigurations, 0);
  assert.equal(result.invalidTraces, 0);
  assert.equal(result.observedCalls, 2);
  assert.deepEqual(result.tools[0], {
    id: "orders",
    name: "lookup_order",
    fields: { covered: 2, total: 2 },
    enumValues: { covered: 2, total: 2 },
    scenarios: { covered: 2, total: 3 },
  });
  assert.equal(result.covered, 6);
  assert.equal(result.total, 7);
  assert.deepEqual(result.gaps, [{
    id: "orders:scenario:0:VIP:step:1",
    toolId: "orders",
    toolName: "lookup_order",
    kind: "sequence",
    target: 'Reach response step 1 in scenario "VIP"',
  }]);
});

test("does not count failed calls or malformed traces as observed coverage", () => {
  const result = analyzeRegressionCoverage(tools, [
    run({ order_id: "1", tier: "vip" }, { state: "pending" }, 500),
    { trace: { calls: [{ toolId: "orders" }] } },
  ]);
  assert.equal(result.observedCalls, 0);
  assert.equal(result.invalidTraces, 1);
  assert.equal(result.covered, 0);
  assert.equal(result.gaps.length, result.total);
});

test("reports invalid tool scenario configuration and safely ignores it", () => {
  const result = analyzeRegressionCoverage([{ ...tools[0], scenarios: { invalid: true } }], []);
  assert.equal(result.invalidToolConfigurations, 1);
  assert.equal(result.total, 4);
});

test("prioritizes scenario and sequence coverage targets with bounded output", () => {
  const gaps = Array.from({ length: 14 }, (_, index) => ({
    id: `tool:field:${index}`,
    toolId: "tool",
    toolName: "mock_tool",
    kind: "field",
    target: `Exercise argument field_${index}`,
  }));
  gaps.push({
    id: "tool:scenario:0:edge",
    toolId: "tool",
    toolName: "mock_tool",
    kind: "scenario",
    target: 'Trigger scenario "edge"',
  });
  gaps.push({
    id: "tool:scenario:0:edge:step:2",
    toolId: "tool",
    toolName: "mock_tool",
    kind: "sequence",
    target: 'Reach response step 2 in scenario "edge"',
  });
  const targets = prioritizeRegressionCoverageGaps(gaps);
  assert.equal(targets.length, 12);
  assert.deepEqual(targets.slice(0, 2).map((target) => target.target), [
    'Reach response step 2 in scenario "edge"',
    'Trigger scenario "edge"',
  ]);
});
