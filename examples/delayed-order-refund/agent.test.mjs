import assert from "node:assert/strict";
import test from "node:test";
import { MockAgent } from "../../packages/mockagent-js/index.mjs";
import { runRefundAgent } from "./agent.mjs";

function createDemoClients() {
  const orderSteps = new Map();
  const toolIds = {
    lookup_order: "lookup-id",
    issue_refund: "refund-id",
    check_inventory: "inventory-id",
  };
  const calls = [];
  const fetch = async (url, init) => {
    const toolName = Object.entries(toolIds).find(([, id]) =>
      new URL(url).pathname.endsWith(`/api/v1/mock/${id}`)
    )?.[0];
    assert.ok(toolName, `Unexpected URL: ${url}`);
    const args = JSON.parse(init.body);
    const runId = new Headers(init.headers).get("x-mockagent-run-id");
    calls.push({ toolName, args, runId });

    if (toolName === "lookup_order") {
      const step = (orderSteps.get(runId) ?? 0) + 1;
      orderSteps.set(runId, step);
      return Response.json({ status: step === 1 ? "pending" : "ready" });
    }
    if (toolName === "check_inventory") return Response.json({ available: true, quantity: 3 });
    if (args.order_status === "pending") {
      return Response.json({ success: false, error: "Order remains pending." });
    }
    return Response.json({ success: true, refund_id: "refund-demo" });
  };

  const clients = Object.fromEntries(Object.entries(toolIds).map(([name, toolId]) => [
    name === "lookup_order" ? "lookupOrder" : name === "issue_refund" ? "issueRefund" : "checkInventory",
    new MockAgent({ toolId, baseUrl: "https://demo.mockagent.test", fetch }),
  ]));
  return { clients, calls };
}

test("the example agent detects the pending-order refund regression", async () => {
  const { clients, calls } = createDemoClients();
  const result = await runRefundAgent({ ...clients, runId: "buggy-run", buggy: true });
  assert.equal(result.passed, false);
  assert.deepEqual(result.calls, ["lookup_order", "issue_refund"]);
  assert.deepEqual(calls.map((call) => call.toolName), ["lookup_order", "issue_refund"]);
  assert.ok(calls.every((call) => call.runId === "buggy-run"));
});

test("the fixed agent waits for ready status and verifies inventory before refunding", async () => {
  const { clients, calls } = createDemoClients();
  const result = await runRefundAgent({ ...clients, runId: "fixed-run" });
  assert.equal(result.passed, true);
  assert.deepEqual(result.calls, ["lookup_order", "lookup_order", "check_inventory", "issue_refund"]);
  assert.deepEqual(calls.map((call) => call.toolName), result.calls);
  assert.ok(calls.every((call) => call.runId === "fixed-run"));
  assert.equal(calls[3].args.order_status, "ready");
});
