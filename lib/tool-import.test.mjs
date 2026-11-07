import assert from "node:assert/strict";
import test from "node:test";
import {
  prepareImportedToolConfigurations,
  previewToolImport,
} from "./tool-import.ts";
import { parseScenarios, resolveScenario, resolveScenarioResponse } from "./scenarios.ts";

test("imports an OpenAPI YAML operation with path, query, body, and response schemas", () => {
  const tools = previewToolImport("openapi", `
openapi: 3.0.3
info:
  title: Orders
  version: 1.0.0
components:
  schemas:
    Order:
      type: object
      properties:
        order_id:
          type: string
          example: order-123
        status:
          type: string
          enum: [shipped, pending]
paths:
  /orders/{orderId}:
    parameters:
      - name: orderId
        in: path
        required: true
        schema:
          type: string
    get:
      operationId: getOrder
      summary: Find an order
      parameters:
        - name: include_history
          in: query
          schema:
            type: boolean
      responses:
        "200":
          description: The order
          content:
            application/json:
              schema:
                $ref: "#/components/schemas/Order"
`);
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "getOrder");
  assert.equal(tools[0].description, "Find an order");
  assert.deepEqual(tools[0].jsonSchema.required, ["orderId"]);
  assert.equal(tools[0].jsonSchema.properties.orderId.type, "string");
  assert.equal(tools[0].jsonSchema.properties.include_history.type, "boolean");
  assert.deepEqual(tools[0].mockResponse, {
    order_id: "order-123",
    status: "shipped",
  });
});

test("imports OpenAI, Anthropic, and MCP tool definition shapes", () => {
  const openAi = previewToolImport("function_tools", JSON.stringify({
    tools: [{
      type: "function",
      function: {
        name: "lookup_order",
        description: "Look up an order.",
        parameters: {
          type: "object",
          properties: { order_id: { type: "string" } },
          required: ["order_id"],
        },
      },
    }],
  }));
  assert.equal(openAi[0].name, "lookup_order");
  assert.deepEqual(openAi[0].mockResponse, { success: true });

  const anthropic = previewToolImport("function_tools", JSON.stringify({
    tools: [{
      name: "refund_order",
      description: "Issue a refund.",
      input_schema: { type: "object", properties: { order_id: { type: "string" } } },
    }],
  }));
  assert.equal(anthropic[0].name, "refund_order");

  const mcp = previewToolImport("mcp_tools", JSON.stringify({
    jsonrpc: "2.0",
    result: {
      tools: [{
        name: "list_orders",
        description: "List orders.",
        inputSchema: { properties: { limit: { type: "integer", default: 10 } } },
        outputSchema: {
          type: "object",
          properties: { count: { type: "integer", example: 2 } },
        },
      }],
    },
  }));
  assert.equal(mcp[0].jsonSchema.type, "object");
  assert.deepEqual(mcp[0].mockResponse, { count: 2 });
  assert.deepEqual(openAi[0].scenarios, []);
});

test("imports HAR traffic into endpoint tools with scrubbed payloads and replayable scenarios", () => {
  const har = {
    log: {
      entries: [
        {
          request: {
            method: "GET",
            url: "https://api.example.test/v1/orders/123?limit=5&api_key=private",
          },
          response: {
            status: 200,
            content: {
              mimeType: "application/json",
              text: JSON.stringify({
                order_id: "123",
                status: "pending",
                access_token: "do-not-store",
                debug_value: `ma_live_${"a".repeat(64)}`,
              }),
            },
          },
        },
        {
          request: {
            method: "GET",
            url: "https://api.example.test/v1/orders/456?limit=10",
            headers: [{ name: "Authorization", value: "Bearer do-not-store" }],
          },
          response: {
            status: 200,
            content: {
              mimeType: "application/json",
              text: JSON.stringify({ order_id: "456", status: "shipped" }),
            },
          },
        },
        {
          request: {
            method: "POST",
            url: "https://api.example.test/v1/orders",
            postData: {
              mimeType: "application/json",
              text: JSON.stringify({ customer_id: "customer-7", password: "do-not-store" }),
            },
          },
          response: {
            status: 201,
            content: { mimeType: "application/json", text: JSON.stringify({ order_id: "new-1" }) },
          },
        },
      ],
    },
  };
  const tools = previewToolImport("har", JSON.stringify(har));
  assert.equal(tools.length, 2);
  const lookup = tools.find((tool) => tool.name.startsWith("get_v1_orders_param1"));
  assert.ok(lookup, `Unexpected HAR tool names: ${tools.map((tool) => tool.name).join(", ")}`);
  assert.equal(lookup.jsonSchema.properties.path.properties.param1.type, "string");
  assert.equal(lookup.jsonSchema.properties.query.properties.limit.type, "string");
  assert.equal("api_key" in lookup.jsonSchema.properties.query.properties, false);
  assert.equal("access_token" in lookup.mockResponse, false);
  assert.equal(JSON.stringify(tools).includes("do-not-store"), false);
  assert.equal(JSON.stringify(tools).includes(`ma_live_${"a".repeat(64)}`), false);
  assert.equal(JSON.stringify(tools).includes("private"), false);

  const scenarios = parseScenarios(lookup.scenarios);
  const matched = resolveScenario(scenarios, {
    path: { param1: "456" },
    query: { limit: "10" },
  });
  assert.ok(matched);
  assert.deepEqual(resolveScenarioResponse(matched), { order_id: "456", status: "shipped" });

  const create = tools.find((tool) => tool.name === "post_v1_orders");
  assert.ok(create);
  assert.equal(create.jsonSchema.properties.body.properties.customer_id.type, "string");
  assert.equal("password" in create.jsonSchema.properties.body.properties, false);
});

test("HAR repeated requests with identical safe arguments become an ordered response sequence", () => {
  const har = {
    log: {
      entries: ["first", "second"].map((status) => ({
        request: { method: "GET", url: "https://api.example.test/status" },
        response: {
          status: 200,
          content: { text: JSON.stringify({ status }) },
        },
      })),
    },
  };
  const [tool] = previewToolImport("har", JSON.stringify(har));
  const [scenario] = parseScenarios(tool.scenarios);
  assert.deepEqual(scenario.responses, [{ status: "first" }, { status: "second" }]);
});

test("HAR normalization treats identifiers after resource paths as path arguments", () => {
  const [tool] = previewToolImport("har", JSON.stringify({
    log: {
      entries: [{
        request: { method: "GET", url: "https://api.example.test/users/alice@example.test" },
        response: { status: 200, content: { text: JSON.stringify({ found: true }) } },
      }],
    },
  }));
  assert.equal(tool.name, "get_users_param1");
  assert.equal(tool.description.includes("alice@example.test"), false);
  assert.equal(tool.scenarios[0].match.properties.path.properties.param1.const, "alice@example.test");
});

test("resolves local OpenAPI references without fetching external refs", () => {
  const source = JSON.stringify({
    openapi: "3.0.0",
    paths: {
      "/items": {
        post: {
          operationId: "createItem",
          requestBody: {
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Item" },
              },
            },
          },
          responses: { "201": { description: "created" } },
        },
      },
    },
    components: {
      schemas: {
        Item: {
          type: "object",
          properties: { sku: { type: "string" } },
          required: ["sku"],
        },
      },
    },
  });
  assert.equal(previewToolImport("openapi", source)[0].jsonSchema.required[0], "sku");

  const external = source.replace(
    '"#/components/schemas/Item"',
    '"https://example.test/item.json"'
  );
  assert.throws(
    () => previewToolImport("openapi", external),
    /External OpenAPI \$ref values are not supported/
  );
});

test("rejects malformed, duplicate, oversized, and excessive imports", () => {
  assert.throws(() => previewToolImport("mcp_tools", "{"), /Could not parse import/);
  assert.throws(() => previewToolImport("har", JSON.stringify({ log: { entries: [] } })), /No suitable JSON/);
  assert.throws(
    () => previewToolImport("function_tools", JSON.stringify([
      { name: "same", parameters: { type: "object" } },
      { name: "same", parameters: { type: "object" } },
    ])),
    /duplicate tool name/
  );
  assert.throws(
    () => previewToolImport("function_tools", " ".repeat(256 * 1024 + 1)),
    /256 KiB/
  );
  const tooManyTools = Array.from({ length: 51 }, (_, index) => ({
    name: `tool_${index}`,
    parameters: { type: "object" },
  }));
  assert.throws(
    () => previewToolImport("function_tools", JSON.stringify(tooManyTools)),
    /at most 50 tools/
  );
});

test("server-side selection must match the previewed import", () => {
  const source = JSON.stringify([
    { name: "first", parameters: { type: "object" } },
    { name: "second", parameters: { type: "object" } },
  ]);
  assert.deepEqual(
    prepareImportedToolConfigurations("function_tools", source, ["second"]).map((tool) => tool.name),
    ["second"]
  );
  assert.throws(
    () => prepareImportedToolConfigurations("function_tools", source, ["missing"]),
    /do not match the pasted import/
  );
  assert.throws(
    () => prepareImportedToolConfigurations("function_tools", source, []),
    /Select at least one tool/
  );
});
