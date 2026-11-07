import assert from "node:assert/strict";
import test from "node:test";
import { compareToolContracts } from "./tool-drift.ts";

const existing = [{
  id: "tool-1",
  name: "lookup_order",
  description: "Look up an order",
  json_schema: {
    type: "object",
    properties: { order_id: { type: "string" } },
    required: ["order_id"],
  },
}];

test("ignores JSON object key order when comparing tool contracts", () => {
  const findings = compareToolContracts(existing, [{
    name: "lookup_order",
    description: "Look up an order",
    jsonSchema: {
      required: ["order_id"],
      properties: { order_id: { type: "string" } },
      type: "object",
    },
    mockResponse: {},
    scenarios: [],
  }]);
  assert.deepEqual(findings, []);
});

test("reports schema paths and description drift with spec and mock values", () => {
  const findings = compareToolContracts(existing, [{
    name: "lookup_order",
    description: "Fetch order details",
    jsonSchema: {
      type: "object",
      properties: {
        order_id: { type: "integer" },
        include_items: { type: "boolean" },
      },
      required: ["order_id", "include_items"],
    },
    mockResponse: {},
    scenarios: [],
  }]);
  assert.deepEqual(findings.map(({ path, kind }) => [path, kind]), [
    ["/properties/order_id/type", "schema"],
    ["/properties/include_items", "schema"],
    ["/required", "schema"],
    ["/description", "description"],
  ]);
});

test("reports tools present in only one side of the comparison", () => {
  const findings = compareToolContracts(existing, [{
    name: "create_order",
    description: "",
    jsonSchema: { type: "object" },
    mockResponse: {},
    scenarios: [],
  }]);
  assert.deepEqual(findings.map(({ kind, toolName }) => [kind, toolName]), [
    ["missing_spec", "lookup_order"],
    ["missing_mock", "create_order"],
  ]);
});
