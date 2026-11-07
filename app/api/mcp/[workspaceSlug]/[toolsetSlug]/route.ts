import { NextResponse, type NextRequest } from "next/server";
import { authenticateMcpRequest } from "@/lib/mcp-auth";
import { executeMockTool } from "@/lib/mock-execution";
import {
  handleMcpMessage,
  jsonRpcError,
  type JsonRpcError,
  type McpCallResult,
  type McpHandlers,
} from "@/lib/mcp-protocol";
import {
  enforceClientRateLimit,
  enforceToolRateLimit,
  enforceWorkspaceQuota,
} from "@/lib/gateway-guards";
import { createAdminClient } from "@/lib/supabase/server";
import { inspectMcpSchema, validateSchemaDefinition } from "@/lib/validators";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const MAX_EXECUTION_MS = 10_000;

interface RouteParams {
  params: Promise<{ workspaceSlug: string; toolsetSlug: string }>;
}

interface McpToolRecord {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  json_schema: Json;
  mock_response: Json;
  scenarios: Json;
  final_answer_assertions: Json;
  is_active: boolean;
  require_api_key: boolean;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseError(status: number, body: Record<string, unknown>) {
  return NextResponse.json(body, { status });
}

function validateOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const parsedOrigin = new URL(origin);
    const requestUrl = new URL(request.url);
    return (
      (parsedOrigin.protocol === "https:" || parsedOrigin.protocol === "http:") &&
      parsedOrigin.username === "" &&
      parsedOrigin.password === "" &&
      parsedOrigin.host.toLowerCase() === requestUrl.host.toLowerCase()
    );
  } catch {
    return false;
  }
}

async function readBoundedBody(request: NextRequest): Promise<string | null> {
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_REQUEST_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function getRequestRunId(params: Record<string, unknown>, request: NextRequest): string | null {
  const meta = isObject(params._meta) ? params._meta : {};
  const mockAgentMeta = isObject(meta["io.mockagent"]) ? meta["io.mockagent"] : {};
  const value =
    meta.runId ??
    meta.run_id ??
    mockAgentMeta.runId ??
    request.headers.get("x-run-id") ??
    request.headers.get("x-mockagent-run-id");
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

function getTraceparent(params: Record<string, unknown>): string | null {
  const meta = isObject(params._meta) ? params._meta : {};
  const value = meta.traceparent ?? meta["io.mockagent/traceparent"];
  return typeof value === "string" && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)
    ? value
    : null;
}

function validationMessage(errors: unknown[] | null): string {
  if (!errors?.length) return "The arguments do not match this tool's input schema.";
  return errors
    .map((item) => {
      if (!isObject(item)) return "Arguments do not match the input schema.";
      if (item.keyword === "invalidSchema") {
        return "This mock tool's schema is invalid. Ask the tool owner to fix it.";
      }
      const path = typeof item.instancePath === "string" && item.instancePath
        ? item.instancePath
        : "/";
      const message = typeof item.message === "string" ? item.message : "does not match the schema";
      return `${path} ${message}`;
    })
    .join("; ");
}

function isScenarioError(response: unknown): boolean {
  if (!isObject(response)) return false;
  const status = response.status;
  return Boolean(
    response.error !== undefined ||
    response.error_code !== undefined ||
    response.isError === true ||
    status === "error" ||
    status === "failed" ||
    (typeof status === "number" && status >= 400)
  );
}

function getErrorMessage(response: unknown): string {
  if (isObject(response)) {
    for (const key of ["message", "error", "error_description"]) {
      if (typeof response[key] === "string") return response[key] as string;
    }
  }
  return "The mock scenario returned an error.";
}

function safeParams(params: Record<string, unknown>) {
  const safe = { ...params };
  delete safe._meta;
  return safe;
}

export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  if (!validateOrigin(request)) {
    return responseError(403, { error: "Origin is not allowed." });
  }
  const clientLimit = await enforceClientRateLimit(request);
  if (clientLimit) return clientLimit;

  const { workspaceSlug, toolsetSlug } = await params;
  const supabase = createAdminClient();
  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id, slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (workspaceError) {
    console.error("MockAgent MCP: workspace lookup failed", workspaceError.message);
    return responseError(503, { error: "MCP endpoint is temporarily unavailable." });
  }
  if (!workspace) return responseError(404, { error: "MCP endpoint not found." });

  const { data: toolset, error: toolsetError } = await supabase
    .from("toolsets")
    .select("id,workspace_id,user_id,name,slug,access_mode,open_token_hash,is_public")
    .eq("workspace_id", workspace.id)
    .eq("slug", toolsetSlug)
    .maybeSingle();
  if (toolsetError) {
    console.error("MockAgent MCP: toolset lookup failed", toolsetError.message);
    return responseError(503, { error: "MCP endpoint is temporarily unavailable." });
  }
  if (!toolset) return responseError(404, { error: "MCP endpoint not found." });

  const toolLimit = await enforceToolRateLimit(toolset.id);
  if (toolLimit) return toolLimit;

  const logEarlyFailure = async (result: Record<string, unknown>, latencyMs: number) => {
    const { error } = await supabase.from("logs").insert({
      workspace_id: workspace.id,
      toolset_id: toolset.id,
      user_id: toolset.user_id,
      payload: {},
      response_body: result as Json,
      status: "SCHEMA_VIOLATION",
      transport: "mcp",
      run_id: request.headers.get("x-run-id") ?? request.headers.get("x-mockagent-run-id"),
      latency_ms: latencyMs,
    });
    if (error) console.error("MockAgent MCP: failed to write malformed-request log", error.message);
  };
  const requestStartedAt = performance.now();
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    const body = { error: "Content-Type must be application/json." };
    await logEarlyFailure(body, Math.round(performance.now() - requestStartedAt));
    return responseError(415, body);
  }

  const rawBody = await readBoundedBody(request);
  if (rawBody === null) {
    const body = jsonRpcError(undefined, -32600, "Request body exceeds the 256 KiB limit.");
    await logEarlyFailure(body, Math.round(performance.now() - requestStartedAt));
    return responseError(413, body);
  }
  let message: unknown;
  try {
    message = JSON.parse(rawBody);
  } catch {
    const body = jsonRpcError(undefined, -32700, "Parse error");
    await logEarlyFailure(body, Math.round(performance.now() - requestStartedAt));
    return responseError(400, body);
  }

  const messageObject = isObject(message) ? message : {};
  const messageParams = isObject(messageObject.params) ? messageObject.params : {};
  const method = typeof messageObject.method === "string" ? messageObject.method : null;
  const toolName = typeof messageParams.name === "string" ? messageParams.name : null;

  const { data: links, error: linksError } = await supabase
    .from("toolset_tools")
    .select("tool_id,position")
    .eq("workspace_id", workspace.id)
    .eq("toolset_id", toolset.id)
    .order("position", { ascending: true });
  if (linksError) {
    console.error("MockAgent MCP: toolset membership lookup failed", linksError.message);
    return responseError(503, { error: "MCP endpoint is temporarily unavailable." });
  }
  const toolIds = (links ?? []).map((link) => link.tool_id);
  let tools: McpToolRecord[] = [];
  if (toolIds.length) {
    const { data, error } = await supabase
      .from("tools")
      .select("id,user_id,workspace_id,name,description,json_schema,mock_response,scenarios,final_answer_assertions,is_active,require_api_key")
      .eq("workspace_id", workspace.id)
      .in("id", toolIds);
    if (error) {
      console.error("MockAgent MCP: member tool lookup failed", error.message);
      return responseError(503, { error: "MCP endpoint is temporarily unavailable." });
    }
    const toolsById = new Map((data ?? []).map((tool) => [tool.id, tool as McpToolRecord]));
    tools = toolIds.flatMap((id) => {
      const tool = toolsById.get(id);
      return tool ? [tool] : [];
    });
  }
  const toolByName = new Map<string, McpToolRecord>();
  for (const tool of tools) {
    if (tool.is_active && !toolByName.has(tool.name)) {
      toolByName.set(tool.name, tool);
    }
  }
  const selectedTool = toolName ? toolByName.get(toolName) : undefined;
  const runId = getRequestRunId(messageParams, request);
  const traceparent = getTraceparent(messageParams);

  const auth = await authenticateMcpRequest(
    request.headers.get("authorization"),
    new URL(request.url).searchParams.get("token"),
    {
      workspaceId: workspace.id,
      accessMode: toolset.access_mode as "api_key" | "open",
      openTokenHash: toolset.open_token_hash,
    },
    toolset.access_mode === "api_key" || Boolean(selectedTool?.require_api_key)
  );

  let requestLogged = false;
  let callLogged = false;
  const logRequest = async (jsonRpcMethod: string, rpcParams: Record<string, unknown>, result: unknown) => {
    if (requestLogged) return;
    requestLogged = true;
    if (callLogged && jsonRpcMethod === "tools/call") return;
    const { error } = await supabase.from("logs").insert({
      workspace_id: workspace.id,
      toolset_id: toolset.id,
      tool_id: toolName ? selectedTool?.id ?? null : null,
      user_id: toolset.user_id,
      payload: safeParams(rpcParams) as Json,
      response_body: (result ?? null) as Json | null,
      api_key_id: auth.apiKeyId,
      status: isObject(result) && ("error" in result || result.isError === true)
        ? "SCHEMA_VIOLATION"
        : "SUCCESS",
      transport: "mcp",
      jsonrpc_method: jsonRpcMethod,
      mcp_tool_name: toolName,
      traceparent,
      run_id: runId,
      error_details: isObject(result) && ("error" in result || result.isError === true)
        ? (result as Json)
        : null,
      latency_ms: Math.round(performance.now() - requestStartedAt),
    });
    if (error) console.error("MockAgent MCP: failed to write protocol log", error.message);
  };

  if (!auth.allowed) {
    await logRequest(method ?? "invalid", messageParams, { error: "Unauthorized" });
    return NextResponse.json(
      { error: "A valid MCP URL token or workspace bearer API key is required." },
      { status: 401, headers: { "WWW-Authenticate": "Bearer" } }
    );
  }

  const handlers: McpHandlers = {
    serverName: `MockAgent ${toolset.name}`,
    serverVersion: process.env.npm_package_version ?? "1.0.0",
    cacheScope: toolset.is_public ? "public" as const : "private" as const,
    async listTools() {
      const seen = new Set<string>();
      return tools
        .filter((tool) => {
          if (!tool.is_active || seen.has(tool.name)) return false;
          seen.add(tool.name);
          const schema = tool.json_schema as Record<string, unknown>;
          return (
            !inspectMcpSchema(schema) &&
            !validateSchemaDefinition(schema) &&
            (schema.type === undefined || schema.type === "object")
          );
        })
        .map((tool) => {
          const inputSchema = structuredClone(tool.json_schema) as Record<string, unknown>;
          if (inputSchema.type === undefined) inputSchema.type = "object";
          return {
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            inputSchema,
          };
        });
    },
    async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult | JsonRpcError> {
      const tool = toolByName.get(name);
      if (!tool || !tool.is_active) {
        return { code: -32602, message: "Unknown or disabled tool." } satisfies JsonRpcError;
      }
      const callLimit = await enforceToolRateLimit(tool.id);
      if (callLimit) {
        const callLimitBody = await callLimit.clone().json();
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: isObject(callLimitBody) && typeof callLimitBody.error === "string"
                ? callLimitBody.error
                : "Tool call rate limit exceeded. Retry later.",
              retryable: true,
              retry_after_seconds: Number(callLimit.headers.get("Retry-After")) || 1,
            }),
          }],
          isError: true,
        };
      }
      const quota = await enforceWorkspaceQuota(supabase, workspace.id, auth.apiKeyId);
      if (quota) {
        const quotaBody = await quota.clone().json();
        const quotaMessage = isObject(quotaBody) && typeof quotaBody.error === "string"
          ? quotaBody.error
          : "Workspace call quota is unavailable. Retry later.";
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              error: quotaMessage,
              retryable: quota.status === 429 || quota.status >= 500,
              retry_after_seconds: Number(quota.headers.get("Retry-After")) || undefined,
            }),
          }],
          isError: true,
        };
      }

      const startedAt = performance.now();
      const requestId = typeof messageObject.id === "string" || typeof messageObject.id === "number"
        ? messageObject.id
        : "";
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), MAX_EXECUTION_MS);
      try {
        const execution = await executeMockTool({
          supabase,
          tool,
          arguments: args,
          runId,
          apiKeyId: auth.apiKeyId,
          startedAt,
          transport: "mcp",
          toolsetId: toolset.id,
          jsonRpcMethod: "tools/call",
          traceparent,
          signal: abortController.signal,
          maxResponseBytes: MAX_RESPONSE_BYTES,
          measureResponseSize: (responseBody) => Buffer.byteLength(JSON.stringify({
            jsonrpc: "2.0",
            id: requestId,
            result: {
              resultType: "complete",
              content: [{ type: "text", text: JSON.stringify(responseBody ?? {}) }],
              isError: false,
            },
          }), "utf8"),
        });
        if (execution.gatewayError) {
          const errorResult = {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error: execution.gatewayError.message,
                retryable: true,
                retry_after_seconds: 1,
              }),
            }],
            isError: true,
          };
          return errorResult;
        }
        callLogged = true;
        if (!execution.valid) {
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                error_code: execution.errorCode,
                message: validationMessage(execution.errors),
                validation_errors: execution.errors,
              }),
            }],
            isError: true,
          };
        }
        if (execution.policyViolations.length > 0) {
          callLogged = true;
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify(execution.responseBody),
            }],
            isError: true,
          };
        }
        const isError = Boolean(execution.injectedFailure) || isScenarioError(execution.responseBody);
        const response = isError && !execution.injectedFailure
          ? {
              ...((isObject(execution.responseBody) ? execution.responseBody : {}) as Record<string, unknown>),
              message: getErrorMessage(execution.responseBody),
            }
          : execution.responseBody;
        return {
          content: [{ type: "text" as const, text: JSON.stringify(response ?? {}) }],
          isError,
        };
      } catch (error) {
        if (abortController.signal.aborted) {
          return {
            content: [{ type: "text", text: "Mock tool execution timed out. Retry the call." }],
            isError: true,
          };
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
    logRequest,
  };

  const response = await handleMcpMessage(message, request.headers, handlers);
  if (!requestLogged) {
    await logRequest(
      response.method ?? "invalid",
      messageParams,
      response.body?.result ?? response.body?.error ?? response.body ?? null
    );
  }
  if (response.notification) return new NextResponse(null, { status: 202 });
  return NextResponse.json(response.body, { status: response.status });
}
