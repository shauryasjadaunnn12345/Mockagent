#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { MockAgent } from "../../packages/mockagent-js/index.mjs";

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Set ${name} to the tool ID from your MockAgent workspace.`);
  return value;
}

export async function runRefundAgent({
  lookupOrder,
  issueRefund,
  checkInventory,
  orderId = "order-42",
  runId = randomUUID(),
  buggy = false,
}) {
  const firstLookup = await lookupOrder.call({ order_id: orderId }, { runId });
  if (!firstLookup || typeof firstLookup.status !== "string") {
    throw new Error("lookup_order returned no readable status.");
  }

  if (buggy) {
    const refund = await issueRefund.call({
      order_id: orderId,
      reason: "delivery_delay",
      order_status: firstLookup.status,
    }, { runId });
    return {
      runId,
      passed: false,
      answer: refund?.success
        ? "Refund processed."
        : `Refund attempt rejected: ${refund?.error ?? "unknown error"}`,
      calls: ["lookup_order", "issue_refund"],
      failure: `The agent attempted a refund while the observed order status was "${firstLookup.status}".`,
    };
  }

  if (firstLookup.status === "pending") {
    const latestLookup = await lookupOrder.call({ order_id: orderId }, { runId });
    if (!latestLookup || typeof latestLookup.status !== "string") {
      throw new Error("The second lookup_order response has no readable status.");
    }
    if (latestLookup.status !== "ready") {
      return {
        runId,
        passed: false,
        answer: `No refund submitted; latest order status is ${latestLookup.status}.`,
        calls: ["lookup_order", "lookup_order"],
        failure: `Order status remained "${latestLookup.status}".`,
      };
    }
  }

  const inventory = await checkInventory.call({ sku: "sku-17" }, { runId });
  if (!inventory || inventory.available !== true) {
    return {
      runId,
      passed: true,
      answer: "No refund submitted because the item is unavailable.",
      calls: ["lookup_order", "lookup_order", "check_inventory"],
    };
  }

  const refund = await issueRefund.call({
    order_id: orderId,
    reason: "delivery_delay",
    order_status: "ready",
  }, { runId });
  if (!refund || refund.success !== true) {
    return {
      runId,
      passed: false,
      answer: `Refund was not processed: ${refund?.error ?? "unknown error"}`,
      calls: ["lookup_order", "lookup_order", "check_inventory", "issue_refund"],
      failure: "A refund was attempted only after verification, but the mock declined it.",
    };
  }

  return {
    runId,
    passed: true,
    answer: `Refund ${refund.refund_id ?? "completed"} processed after confirming the order was ready.`,
    calls: ["lookup_order", "lookup_order", "check_inventory", "issue_refund"],
  };
}

async function main() {
  const buggy = process.argv.includes("--buggy");
  const baseUrl = process.env.MOCKAGENT_BASE_URL?.trim() || "https://mockagent.online";
  const apiKey = process.env.MOCKAGENT_API_KEY?.trim();
  const clients = {
    lookupOrder: new MockAgent({
      toolId: requiredEnv("MOCKAGENT_LOOKUP_ORDER_TOOL_ID"),
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
    }),
    issueRefund: new MockAgent({
      toolId: requiredEnv("MOCKAGENT_ISSUE_REFUND_TOOL_ID"),
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
    }),
    checkInventory: new MockAgent({
      toolId: requiredEnv("MOCKAGENT_CHECK_INVENTORY_TOOL_ID"),
      baseUrl,
      ...(apiKey ? { apiKey } : {}),
    }),
  };

  const result = await runRefundAgent({
    ...clients,
    orderId: process.env.DEMO_ORDER_ID?.trim() || "order-42",
    buggy,
  });
  console.log(`${result.passed ? "PASS" : "REGRESSION"} ${result.answer}`);
  console.log(`Run ID: ${result.runId}`);
  console.log(`Tool sequence: ${result.calls.join(" → ")}`);
  if (result.failure) console.error(result.failure);
  if (!result.passed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "The sample agent failed.");
    process.exitCode = 2;
  });
}
