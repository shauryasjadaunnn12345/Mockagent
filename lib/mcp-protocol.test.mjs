import assert from "node:assert/strict";
import test from "node:test";
import { handleMcpMessage, MCP_PROTOCOL_VERSION } from "./mcp-protocol.ts";

const currentMeta = {
  "io.modelcontextprotocol/protocolVersion": MCP_PROTOCOL_VERSION,
  "io.modelcontextprotocol/clientInfo": { name: "test-client", version: "1.0.0" },
};

function request(method, params = {}, id = 1) {
  return { jsonrpc: "2.0", id, method, params };
}

function headers(method, version = MCP_PROTOCOL_VERSION, name) {
  const values = {
    "MCP-Protocol-Version": version,
    "Mcp-Method": method,
  };
  if (name) values["Mcp-Name"] = name;
  return new Headers(values);
}

function makeHandlers() {
  return {
    serverName: "MockAgent test",
    serverVersion: "1.0.0",
    cacheScope: "private",
    async listTools() {
      return [{ name: "lookup", inputSchema: { type: "object" } }];
    },
    async callTool(name, args) {
      if (name !== "lookup") return { code: -32602, message: "Unknown tool." };
      return {
        content: [{ type: "text", text: JSON.stringify({ found: args.id }) }],
        isError: false,
      };
    },
  };
}

test("supports current discovery, list, and call", async () => {
  const handlers = makeHandlers();
  const discover = await handleMcpMessage(
    request("server/discover", { _meta: currentMeta }),
    headers("server/discover"),
    handlers
  );
  assert.equal(discover.status, 200);
  assert.deepEqual(discover.body.result.supportedVersions, [
    MCP_PROTOCOL_VERSION,
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
  ]);
  assert.deepEqual(discover.body.result.capabilities, { tools: {} });

  const list = await handleMcpMessage(
    request("tools/list", { _meta: currentMeta }),
    headers("tools/list"),
    handlers
  );
  assert.equal(list.body.result.resultType, "complete");
  assert.equal(list.body.result.ttlMs, 300_000);
  assert.equal(list.body.result.cacheScope, "private");
  assert.equal(list.body.result.tools[0].name, "lookup");

  const call = await handleMcpMessage(
    request("tools/call", {
      _meta: currentMeta,
      name: "lookup",
      arguments: { id: "order-1" },
    }),
    headers("tools/call", MCP_PROTOCOL_VERSION, "lookup"),
    handlers
  );
  assert.equal(call.body.result.isError, false);
  assert.deepEqual(call.body.result.content, [
    { type: "text", text: '{"found":"order-1"}' },
  ]);
});

test("supports the legacy initialize, initialized notification, and ping flow without sessions", async () => {
  const handlers = makeHandlers();
  const initialized = await handleMcpMessage(
    request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "legacy", version: "1" },
    }),
    new Headers({ "Mcp-Session-Id": "ignored-session" }),
    handlers
  );
  assert.equal(initialized.body.result.protocolVersion, "2025-11-25");
  assert.deepEqual(initialized.body.result.capabilities, { tools: {} });

  const notification = await handleMcpMessage(
    { jsonrpc: "2.0", method: "notifications/initialized" },
    new Headers({ "Mcp-Session-Id": "ignored-session" }),
    handlers
  );
  assert.equal(notification.status, 202);
  assert.equal(notification.body, undefined);

  const ping = await handleMcpMessage(
    request("ping"),
    new Headers({
      "Mcp-Session-Id": "ignored-session",
      "MCP-Protocol-Version": "2025-11-25",
    }),
    handlers
  );
  assert.deepEqual(ping.body.result, {});
});

test("rejects routing and protocol-version header mismatches", async () => {
  const methodMismatch = await handleMcpMessage(
    request("tools/list", { _meta: currentMeta }),
    headers("tools/call"),
    makeHandlers()
  );
  assert.equal(methodMismatch.body.error.code, -32020);
  assert.equal(methodMismatch.status, 400);

  const versionMismatch = await handleMcpMessage(
    request("tools/list", { _meta: currentMeta }),
    headers("tools/list", "2025-11-25"),
    makeHandlers()
  );
  assert.equal(versionMismatch.body.error.code, -32020);
});

test("returns unsupported-version errors for missing and unsupported modern versions", async () => {
  const missing = await handleMcpMessage(
    request("server/discover"),
    new Headers(),
    makeHandlers()
  );
  assert.equal(missing.body.error.code, -32022);
  assert.deepEqual(missing.body.error.data.supported, [
    MCP_PROTOCOL_VERSION,
    "2025-11-25",
    "2025-06-18",
    "2025-03-26",
    "2024-11-05",
  ]);

  const missingListVersion = await handleMcpMessage(
    request("tools/list"),
    new Headers({ "Mcp-Method": "tools/list" }),
    makeHandlers()
  );
  assert.equal(missingListVersion.body.error.code, -32022);

  const unsupportedMeta = { ...currentMeta, "io.modelcontextprotocol/protocolVersion": "1900-01-01" };
  const unsupported = await handleMcpMessage(
    request("server/discover", { _meta: unsupportedMeta }),
    headers("server/discover", "1900-01-01"),
    makeHandlers()
  );
  assert.equal(unsupported.body.error.code, -32022);
  assert.equal(unsupported.body.error.message, "Unsupported protocol version");
});

test("returns invalid-params for malformed calls and unknown tools", async () => {
  const malformed = await handleMcpMessage(
    request("tools/call", { _meta: currentMeta, name: "lookup", arguments: [] }),
    headers("tools/call"),
    makeHandlers()
  );
  assert.equal(malformed.body.error.code, -32602);

  const unknown = await handleMcpMessage(
    request("tools/call", { _meta: currentMeta, name: "missing", arguments: {} }),
    headers("tools/call"),
    makeHandlers()
  );
  assert.equal(unknown.body.error.code, -32602);
});

test("preserves model-readable validation failures as tool results", async () => {
  const handlers = makeHandlers();
  handlers.callTool = async () => ({
    content: [{
      type: "text",
      text: JSON.stringify({
        error_code: "SCHEMA_VALIDATION_FAILED",
        message: "/order_id must be string",
      }),
    }],
    isError: true,
  });
  const response = await handleMcpMessage(
    request("tools/call", {
      _meta: currentMeta,
      name: "lookup",
      arguments: { order_id: 123 },
    }),
    headers("tools/call", MCP_PROTOCOL_VERSION, "lookup"),
    handlers
  );
  assert.equal(response.body.result.isError, true);
  assert.match(response.body.result.content[0].text, /order_id must be string/);
});

test("returns method-not-found and enforces name routing headers", async () => {
  const unknown = await handleMcpMessage(
    request("resources/list", { _meta: currentMeta }),
    headers("resources/list"),
    makeHandlers()
  );
  assert.equal(unknown.body.error.code, -32601);

  const mismatch = await handleMcpMessage(
    request("tools/call", {
      _meta: currentMeta,
      name: "lookup",
      arguments: {},
    }),
    headers("tools/call", MCP_PROTOCOL_VERSION, "other"),
    makeHandlers()
  );
  assert.equal(mismatch.body.error.code, -32020);
});
