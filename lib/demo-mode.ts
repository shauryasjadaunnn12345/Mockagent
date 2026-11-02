import { analyzeRegressionCoverage } from "./regression-coverage.ts";
import { parseScenarios, resolveScenario, resolveScenarioResponse } from "./scenarios.ts";

export const DEMO_FAILED_CHECK = "No refund attempt while the order is pending";

export const DEMO_FLAWED_AGENT_PROMPT =
  "If an order is delayed, immediately issue a refund. Do not re-check its status or inventory.";

export const DEMO_CORRECTED_AGENT_PROMPT =
  "Look up the order status again if it is pending. Check inventory, and issue a refund only after the order is ready.";

export const DEMO_TOOLS = [
  {
    id: "demo-lookup-order",
    name: "lookup_order",
    description: "Look up an order and its latest status.",
    json_schema: {
      type: "object",
      properties: { order_id: { type: "string" } },
      required: ["order_id"],
      additionalProperties: false,
    },
    mock_response: { order_id: "demo-42", status: "ready" },
    scenarios: [
      {
        name: "Delayed order becomes ready",
        match: { type: "object", properties: { order_id: { const: "demo-42" } }, required: ["order_id"] },
        responses: [
          { order_id: "demo-42", status: "pending", delay_reason: "carrier_scan_missing" },
          { order_id: "demo-42", status: "ready", delay_reason: null },
        ],
      },
      {
        name: "Cancelled order",
        match: { type: "object", properties: { order_id: { const: "demo-cancelled" } }, required: ["order_id"] },
        response: { order_id: "demo-cancelled", status: "cancelled" },
      },
    ],
  },
  {
    id: "demo-issue-refund",
    name: "issue_refund",
    description: "Submit a simulated refund after verifying the current order status.",
    json_schema: {
      type: "object",
      properties: {
        order_id: { type: "string" },
        reason: { type: "string", enum: ["delivery_delay", "damaged_item"] },
        order_status: { type: "string", enum: ["pending", "ready", "cancelled"] },
      },
      required: ["order_id", "reason"],
      additionalProperties: false,
    },
    mock_response: { success: false, error: "Confirm the current order status before refunding." },
    scenarios: [
      {
        name: "Refund blocked while pending",
        match: { type: "object", properties: { order_status: { const: "pending" } }, required: ["order_status"] },
        response: { success: false, error: "Order is still pending; no refund was issued." },
      },
      {
        name: "Refund allowed when ready",
        match: { type: "object", properties: { order_status: { const: "ready" } }, required: ["order_status"] },
        response: { success: true, refund_id: "demo-refund-1", status: "processed" },
      },
      {
        name: "Already refunded",
        match: { type: "object", properties: { order_id: { const: "demo-refunded" } }, required: ["order_id"] },
        response: { success: false, error: "Order was already refunded.", code: "ALREADY_REFUNDED" },
      },
    ],
  },
  {
    id: "demo-check-inventory",
    name: "check_inventory",
    description: "Check mock inventory availability for an SKU.",
    json_schema: {
      type: "object",
      properties: { sku: { type: "string", enum: ["demo-sku-17", "demo-sku-oos"] } },
      required: ["sku"],
      additionalProperties: false,
    },
    mock_response: { sku: "demo-sku-17", available: true, quantity: 4 },
    scenarios: [
      {
        name: "In stock",
        match: { type: "object", properties: { sku: { const: "demo-sku-17" } }, required: ["sku"] },
        response: { sku: "demo-sku-17", available: true, quantity: 4 },
      },
      {
        name: "Out of stock",
        match: { type: "object", properties: { sku: { const: "demo-sku-oos" } }, required: ["sku"] },
        response: { sku: "demo-sku-oos", available: false, quantity: 0 },
      },
    ],
  },
] as const;

export interface DemoToolCall {
  toolId: string;
  toolName: string;
  arguments: string;
  response: string;
  status: number;
}

export interface DemoRun {
  answer: string;
  calls: DemoToolCall[];
  passed: boolean;
  actual: string;
}

function callDemoTool(toolName: string, args: Record<string, unknown>, step: number): DemoToolCall {
  const tool = DEMO_TOOLS.find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`Unknown demo tool "${toolName}".`);

  const scenario = resolveScenario(parseScenarios(tool.scenarios), args);
  const response = scenario ? resolveScenarioResponse(scenario, step) : tool.mock_response;
  const success = !("success" in response) || response.success !== false;
  return {
    toolId: tool.id,
    toolName,
    arguments: JSON.stringify(args),
    response: JSON.stringify(response),
    status: success ? 200 : 409,
  };
}

export function runFlawedDemoAgent(): DemoRun {
  const lookup = callDemoTool("lookup_order", { order_id: "demo-42" }, 1);
  const refund = callDemoTool("issue_refund", {
    order_id: "demo-42",
    reason: "delivery_delay",
  }, 1);
  return {
    answer: "I submitted a refund for the delayed order.",
    calls: [lookup, refund],
    passed: false,
    actual: "Refund was attempted while the latest order status was pending.",
  };
}

export function runCorrectedDemoAgent(): DemoRun {
  const firstLookup = callDemoTool("lookup_order", { order_id: "demo-42" }, 1);
  const secondLookup = callDemoTool("lookup_order", { order_id: "demo-42" }, 2);
  const inventory = callDemoTool("check_inventory", { sku: "demo-sku-17" }, 1);
  const refund = callDemoTool("issue_refund", {
    order_id: "demo-42",
    reason: "delivery_delay",
    order_status: "ready",
  }, 1);
  return {
    answer: "The order is ready, inventory is available, and the simulated refund was processed.",
    calls: [firstLookup, secondLookup, inventory, refund],
    passed: true,
    actual: "The agent re-checked the order, verified inventory, then refunded only after status was ready.",
  };
}

export function measureDemoCoverage(runs: DemoRun[]) {
  return analyzeRegressionCoverage(
    DEMO_TOOLS.map(({ id, name, json_schema, scenarios }) => ({
      id,
      name,
      json_schema,
      scenarios,
    })),
    runs.map((run) => ({
      trace: {
        answer: run.answer,
        calls: run.calls,
      },
    })),
  );
}
