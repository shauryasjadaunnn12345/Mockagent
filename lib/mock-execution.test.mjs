import assert from "node:assert/strict";
import test from "node:test";
import { executeMockTool } from "./mock-execution.ts";
import { previewToolImport } from "./tool-import.ts";

class LogQuery {
  constructor(database) {
    this.database = database;
    this.filters = {};
    this.operation = "select";
    this.row = null;
  }

  select() { this.operation = "select"; return this; }
  eq(key, value) { this.filters[key] = value; return this; }
  abortSignal() { return this; }
  insert(row) { this.operation = "insert"; this.row = row; return this; }

  then(resolve, reject) {
    const result = Promise.resolve().then(() => {
      if (this.operation === "insert") {
        this.database.logs.push(this.row);
        return { error: null };
      }
      const matching = this.database.logs.filter((row) =>
        Object.entries(this.filters).every(([key, value]) => row[key] === value)
      );
      return { data: [], count: matching.length, error: null };
    });
    return result.then(resolve, reject);
  }
}

class FakeDatabase {
  logs = [];
  from(table) {
    assert.equal(table, "logs");
    return new LogQuery(this);
  }
}

const tool = {
  id: "tool-1",
  user_id: "user-1",
  workspace_id: "workspace-1",
  name: "lookup",
  json_schema: {
    type: "object",
    properties: { mode: { type: "string" }, id: { type: "string" } },
    required: ["mode"],
    additionalProperties: false,
  },
  mock_response: { ok: true },
  scenarios: [
    {
      name: "sequence",
      match: { type: "object", properties: { mode: { const: "sequence" } }, required: ["mode"] },
      responses: [{ step: 1 }, { step: 2 }],
    },
    {
      name: "retry",
      match: { type: "object", properties: { mode: { const: "fault" } }, required: ["mode"] },
      response: { ok: true },
      failures: [{
        step: 1,
        status: 503,
        errorCode: "UPSTREAM_UNAVAILABLE",
        message: "Try again later.",
        retryAfterSeconds: 2,
      }],
    },
  ],
};

async function run(db, overrides = {}) {
  return executeMockTool({
    supabase: db,
    tool,
    arguments: { mode: "sequence" },
    runId: "run-1",
    apiKeyId: null,
    startedAt: performance.now(),
    ...overrides,
  });
}

test("validates through the shared engine and produces useful field errors", async () => {
  const db = new FakeDatabase();
  const result = await run(db, { arguments: {} });
  assert.equal(result.valid, false);
  assert.equal(result.status, "SCHEMA_VIOLATION");
  assert.match(result.errors[0].message, /required property/);
  assert.equal(db.logs[0].transport, "http");
});

test("blocks unsafe tool arguments before scenarios and records a policy violation", async () => {
  const db = new FakeDatabase();
  const guardedTool = {
    ...tool,
    json_schema: {
      ...tool.json_schema,
      properties: {
        ...tool.json_schema.properties,
        confirmed: { type: "boolean" },
      },
    },
    final_answer_assertions: [{
      name: "Require refund confirmation",
      type: "call_guard",
      path: "/confirmed",
      operator: "equals",
      value: true,
      message: "Refunds require explicit confirmation.",
    }],
  };
  const result = await run(db, {
    tool: guardedTool,
    arguments: { mode: "sequence", confirmed: false },
  });
  assert.equal(result.valid, true);
  assert.equal(result.status, "POLICY_VIOLATION");
  assert.equal(result.policyViolations.length, 1);
  assert.equal(result.policyViolations[0].message, "Refunds require explicit confirmation.");
  assert.equal(result.responseBody.error_code, "SAFETY_GUARD_BLOCKED");
  assert.equal(db.logs[0].status, "POLICY_VIOLATION");
  assert.equal(db.logs[0].scenario_name, null);
});

test("keeps scenario matching and response sequences identical across HTTP and MCP", async () => {
  const httpDb = new FakeDatabase();
  const mcpDb = new FakeDatabase();
  const firstHttp = await run(httpDb);
  const firstMcp = await run(mcpDb, { transport: "mcp", toolsetId: "set-1", jsonRpcMethod: "tools/call" });
  const nextHttp = await run(httpDb);
  const nextMcp = await run(mcpDb, { transport: "mcp", toolsetId: "set-1", jsonRpcMethod: "tools/call" });
  const freshRunMcp = await run(mcpDb, {
    runId: "run-2",
    transport: "mcp",
    toolsetId: "set-1",
    jsonRpcMethod: "tools/call",
  });

  assert.deepEqual(firstHttp.responseBody, firstMcp.responseBody);
  assert.equal(firstHttp.scenarioName, firstMcp.scenarioName);
  assert.equal(firstHttp.scenarioStep, 1);
  assert.equal(firstMcp.scenarioStep, 1);
  assert.deepEqual(nextHttp.responseBody, nextMcp.responseBody);
  assert.equal(nextHttp.scenarioStep, 2);
  assert.equal(nextMcp.scenarioStep, 2);
  assert.equal(freshRunMcp.scenarioStep, 1);
  assert.deepEqual(freshRunMcp.responseBody, { step: 1 });
  assert.equal(mcpDb.logs[0].transport, "mcp");
  assert.equal(mcpDb.logs[0].jsonrpc_method, "tools/call");
  assert.equal(mcpDb.logs[0].toolset_id, "set-1");
});

test("maps scheduled transient faults identically and records the retry step", async () => {
  const httpDb = new FakeDatabase();
  const mcpDb = new FakeDatabase();
  const httpResult = await run(httpDb, {
    arguments: { mode: "fault" },
    runId: "fault-run-http",
  });
  const mcpResult = await run(mcpDb, {
    arguments: { mode: "fault" },
    runId: "fault-run-mcp",
    transport: "mcp",
  });

  assert.equal(httpResult.status, "INJECTED_FAILURE");
  assert.equal(mcpResult.status, "INJECTED_FAILURE");
  assert.deepEqual(httpResult.responseBody, mcpResult.responseBody);
  assert.equal(mcpResult.responseBody.retry_after_seconds, 2);
  assert.equal(mcpDb.logs[0].scenario_step, 1);
});

test("caps the complete serialized MCP result size", async () => {
  const largeTool = {
    ...tool,
    scenarios: [],
    mock_response: { large: "x".repeat(5_000) },
  };
  const result = await executeMockTool({
    supabase: new FakeDatabase(),
    tool: largeTool,
    arguments: { mode: "sequence" },
    runId: null,
    apiKeyId: null,
    startedAt: performance.now(),
    transport: "mcp",
    maxResponseBytes: 100,
    measureResponseSize: (response) => JSON.stringify(response).length,
  });
  assert.equal(result.status, "INJECTED_FAILURE");
  assert.equal(result.injectedFailure.errorCode, "MCP_RESULT_TOO_LARGE");
});

test("executes HAR-imported response sequences through the shared mock engine", async () => {
  const [imported] = previewToolImport("har", JSON.stringify({
    log: {
      entries: ["pending", "shipped"].map((status) => ({
        request: { method: "GET", url: "https://api.example.test/orders/42" },
        response: { status: 200, content: { text: JSON.stringify({ status }) } },
      })),
    },
  }));
  const importedTool = {
    ...tool,
    name: imported.name,
    json_schema: imported.jsonSchema,
    mock_response: imported.mockResponse,
    scenarios: imported.scenarios,
  };
  const db = new FakeDatabase();
  const executeCaptured = () => executeMockTool({
    supabase: db,
    tool: importedTool,
    arguments: { path: { param1: "42" } },
    runId: "captured-run",
    apiKeyId: null,
    startedAt: performance.now(),
  });

  const first = await executeCaptured();
  const second = await executeCaptured();
  assert.deepEqual(first.responseBody, { status: "pending" });
  assert.deepEqual(second.responseBody, { status: "shipped" });
  assert.equal(first.scenarioName, "Captured case 1");
  assert.equal(second.scenarioStep, 2);
});
