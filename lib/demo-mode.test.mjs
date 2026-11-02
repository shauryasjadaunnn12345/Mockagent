import assert from "node:assert/strict";
import test from "node:test";
import {
  DEMO_CORRECTED_AGENT_PROMPT,
  DEMO_FAILED_CHECK,
  DEMO_FLAWED_AGENT_PROMPT,
  DEMO_TOOLS,
  measureDemoCoverage,
  runCorrectedDemoAgent,
  runFlawedDemoAgent,
} from "./demo-mode.ts";

test("seeds the three sandbox tools with edge cases and a pending-to-ready sequence", () => {
  assert.deepEqual(DEMO_TOOLS.map((tool) => tool.name), [
    "lookup_order",
    "issue_refund",
    "check_inventory",
  ]);
  const delayedOrder = DEMO_TOOLS[0].scenarios[0];
  assert.equal(delayedOrder.responses[0].status, "pending");
  assert.equal(delayedOrder.responses[1].status, "ready");
  assert.ok(DEMO_TOOLS[1].scenarios.some((scenario) => scenario.name === "Already refunded"));
  assert.ok(DEMO_TOOLS[2].scenarios.some((scenario) => scenario.name === "Out of stock"));
});

test("the flawed demo agent fails and the corrected agent replays the sequence safely", () => {
  const flawed = runFlawedDemoAgent();
  const corrected = runCorrectedDemoAgent();
  assert.match(DEMO_FLAWED_AGENT_PROMPT, /Do not re-check/);
  assert.match(DEMO_CORRECTED_AGENT_PROMPT, /only after the order is ready/);
  assert.equal(DEMO_FAILED_CHECK, "No refund attempt while the order is pending");
  assert.equal(flawed.passed, false);
  assert.equal(flawed.calls[0].toolName, "lookup_order");
  assert.deepEqual(JSON.parse(flawed.calls[0].response), {
    order_id: "demo-42",
    status: "pending",
    delay_reason: "carrier_scan_missing",
  });
  assert.equal(corrected.passed, true);
  assert.deepEqual(corrected.calls.slice(0, 2).map((call) => JSON.parse(call.response).status), [
    "pending",
    "ready",
  ]);
  assert.equal(corrected.calls[2].toolName, "check_inventory");
  assert.equal(JSON.parse(corrected.calls[3].response).success, true);
});

test("coverage increases after the reviewed regression case is rerun", () => {
  const before = measureDemoCoverage([runFlawedDemoAgent()]);
  const after = measureDemoCoverage([runFlawedDemoAgent(), runCorrectedDemoAgent()]);
  assert.ok(after.percentage > before.percentage);
  assert.ok(after.covered > before.covered);
});
