export const MCP_PROTOCOL_VERSION = "2026-07-28";
export const MCP_LEGACY_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
export const MCP_SUPPORTED_VERSIONS = [
  MCP_PROTOCOL_VERSION,
  ...MCP_LEGACY_PROTOCOL_VERSIONS,
] as const;

export type JsonRpcId = string | number;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface McpCallResult {
  content: Array<{ type: "text"; text: string }>;
  isError: boolean;
  structuredContent?: Record<string, unknown>;
}

export interface McpHandlers {
  serverName: string;
  serverVersion: string;
  cacheScope: "public" | "private";
  listTools(): Promise<Array<Record<string, unknown>>>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult | JsonRpcError>;
  logRequest?(method: string, params: Record<string, unknown>, result: unknown): Promise<void>;
}

export interface McpResponse {
  status: number;
  body?: Record<string, unknown>;
  method: string | null;
  notification: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRpcId(value: unknown): value is JsonRpcId {
  return (
    (typeof value === "string" && value.length <= 256) ||
    (typeof value === "number" && Number.isFinite(value))
  );
}

export function jsonRpcError(
  id: JsonRpcId | undefined,
  code: number,
  message: string,
  data?: unknown
): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    ...(id === undefined ? {} : { id }),
    error: { code, message, ...(data === undefined ? {} : { data }) },
  };
}

function headerMismatch(
  id: JsonRpcId | undefined,
  header: string,
  expected: unknown,
  received: string | null
) {
  return jsonRpcError(id, -32020, "Request header does not match JSON-RPC body", {
    header,
    expected: typeof expected === "string" ? expected : null,
    received,
  });
}

function protocolVersionError(id: JsonRpcId | undefined, requested: unknown) {
  return jsonRpcError(id, -32022, "Unsupported protocol version", {
    supported: [...MCP_SUPPORTED_VERSIONS],
    requested: typeof requested === "string" ? requested : null,
  });
}

function invalidParams(id: JsonRpcId | undefined, message = "Invalid method parameters") {
  return jsonRpcError(id, -32602, message);
}

function result(id: JsonRpcId, value: unknown) {
  return { jsonrpc: "2.0", id, result: value };
}

function getLegacyVersion(requested: unknown): string | null {
  if (typeof requested !== "string") return null;
  return MCP_LEGACY_PROTOCOL_VERSIONS.includes(
    requested as (typeof MCP_LEGACY_PROTOCOL_VERSIONS)[number]
  )
    ? requested
    : null;
}

async function dispatchMethod(
  method: string,
  params: Record<string, unknown>,
  id: JsonRpcId,
  handlers: McpHandlers,
  legacy: boolean
): Promise<Record<string, unknown>> {
  if (method === "initialize") {
    const protocolVersion = getLegacyVersion(params.protocolVersion);
    if (!protocolVersion) {
      return jsonRpcError(id, -32602, "Unsupported legacy protocol version", {
        supported: [...MCP_LEGACY_PROTOCOL_VERSIONS],
      });
    }
    return result(id, {
      protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: handlers.serverName, version: handlers.serverVersion },
    });
  }
  if (method === "ping") return result(id, {});
  if (method === "server/discover") {
    return result(id, {
      resultType: "complete",
      supportedVersions: [...MCP_SUPPORTED_VERSIONS],
      capabilities: { tools: {} },
      _meta: {
        "io.modelcontextprotocol/serverInfo": {
          name: handlers.serverName,
          version: handlers.serverVersion,
        },
      },
      ttlMs: 300_000,
      cacheScope: handlers.cacheScope,
    });
  }
  if (method === "tools/list") {
    const tools = await handlers.listTools();
    return result(id, {
      ...(legacy ? {} : { resultType: "complete" }),
      tools,
      ...(legacy
        ? {}
        : { ttlMs: 300_000, cacheScope: handlers.cacheScope }),
    });
  }
  if (method === "tools/call") {
    if (typeof params.name !== "string" || !isObject(params.arguments)) {
      return invalidParams(id, "tools/call requires a tool name and an object of arguments.");
    }
    const callResult = await handlers.callTool(params.name, params.arguments);
    if ("code" in callResult) {
      return jsonRpcError(id, callResult.code, callResult.message, callResult.data);
    }
    return result(id, {
      ...(legacy ? {} : { resultType: "complete" }),
      ...callResult,
    });
  }
  return jsonRpcError(id, -32601, "Method not found");
}

export async function handleMcpMessage(
  message: unknown,
  headers: Headers,
  handlers: McpHandlers
): Promise<McpResponse> {
  if (!isObject(message) || message.jsonrpc !== "2.0" || typeof message.method !== "string") {
    return {
      status: 400,
      body: jsonRpcError(undefined, -32600, "Invalid Request"),
      method: null,
      notification: false,
    };
  }

  const method = message.method;
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const id = isRpcId(message.id) ? message.id : undefined;
  if (hasId && id === undefined) {
    return {
      status: 400,
      body: jsonRpcError(undefined, -32600, "Invalid Request"),
      method,
      notification: false,
    };
  }
  if (hasId && method.startsWith("notifications/")) {
    return {
      status: 400,
      body: jsonRpcError(id, -32600, "Notifications must not include an id"),
      method,
      notification: false,
    };
  }
  const params = message.params === undefined ? {} : message.params;
  if (!isObject(params)) {
    return {
      status: 200,
      body: jsonRpcError(id, -32602, "Method parameters must be an object"),
      method,
      notification: id === undefined,
    };
  }

  const methodHeader = headers.get("mcp-method");
  if (methodHeader !== null && methodHeader !== method) {
    return {
      status: 400,
      body: headerMismatch(id, "Mcp-Method", method, methodHeader),
      method,
      notification: false,
    };
  }
  const nameHeader = headers.get("mcp-name");
  if (nameHeader !== null && nameHeader !== params.name) {
    return {
      status: 400,
      body: headerMismatch(id, "Mcp-Name", params.name, nameHeader),
      method,
      notification: false,
    };
  }

  if (method.startsWith("notifications/")) {
    const response: McpResponse = { status: 202, method, notification: true };
    if (handlers.logRequest) await handlers.logRequest(method, params, null);
    return response;
  }

  const meta = isObject(params._meta) ? params._meta : {};
  const bodyVersion = meta["io.modelcontextprotocol/protocolVersion"];
  const headerVersion = headers.get("mcp-protocol-version");
  if (
    typeof bodyVersion === "string" &&
    typeof headerVersion === "string" &&
    bodyVersion !== headerVersion
  ) {
    const body = headerMismatch(id, "MCP-Protocol-Version", bodyVersion, headerVersion);
    if (handlers.logRequest) await handlers.logRequest(method, params, body.error);
    return { status: 400, body, method, notification: false };
  }
  const isLegacy = method !== "server/discover" && (
    (method === "initialize" && bodyVersion === undefined && headerVersion === null) ||
    Boolean(getLegacyVersion(bodyVersion)) ||
    Boolean(getLegacyVersion(headerVersion))
  );
  if (!isLegacy) {
    if (bodyVersion === undefined && headerVersion === null) {
      const body = protocolVersionError(id, null);
      if (handlers.logRequest) await handlers.logRequest(method, params, body.error);
      return { status: 400, body, method, notification: false };
    }
    if (
      typeof bodyVersion !== "string" ||
      typeof headerVersion !== "string" ||
      bodyVersion !== headerVersion
    ) {
      const body = headerMismatch(id, "MCP-Protocol-Version", bodyVersion, headerVersion);
      if (handlers.logRequest) await handlers.logRequest(method, params, body.error);
      return { status: 400, body, method, notification: false };
    }
    if (bodyVersion !== MCP_PROTOCOL_VERSION) {
      const body = protocolVersionError(id, bodyVersion);
      if (handlers.logRequest) await handlers.logRequest(method, params, body.error);
      return { status: 400, body, method, notification: false };
    }
  }

  if (id === undefined) {
    const response: McpResponse = { status: 202, method, notification: true };
    if (handlers.logRequest) await handlers.logRequest(method, params, null);
    return response;
  }

  if (method === "initialize") {
    const body = await dispatchMethod(method, params, id, handlers, true);
    if (handlers.logRequest) await handlers.logRequest(method, params, body.result ?? body.error);
    return { status: 200, body, method, notification: false };
  }

  let body: Record<string, unknown>;
  try {
    body = await dispatchMethod(method, params, id, handlers, isLegacy);
  } catch (error) {
    console.error("MockAgent MCP: request handler failed", error);
    body = jsonRpcError(id, -32603, "Internal error");
  }
  if (handlers.logRequest) await handlers.logRequest(method, params, body.result ?? body.error);
  return { status: 200, body, method, notification: false };
}
