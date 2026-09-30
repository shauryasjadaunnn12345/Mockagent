import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/server";
import {
  checkGatewayRateLimit,
  isGatewayRateLimitConfigured,
} from "@/lib/rate-limit";
import { validateAgainstSchema } from "@/lib/validators";
import { parseScenarios, resolveScenario, resolveScenarioResponse } from "@/lib/scenarios";
import type { ExecutionStatus, Json } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ toolId: string }>;
}

interface ApiKeyProtectedTool {
  id: string;
  user_id: string;
  workspace_id: string;
  require_api_key: boolean;
}

async function enforceApiKey(
  request: NextRequest,
  tool: ApiKeyProtectedTool
): Promise<{ apiKeyId: string | null; response: NextResponse | null }> {
  if (!tool.require_api_key) return { apiKeyId: null, response: null };

  const authorization = request.headers.get("authorization");
  const token = authorization?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) {
    return {
      apiKeyId: null,
      response: NextResponse.json({ error: "A valid bearer API key is required." }, { status: 401 }),
    };
  }

  const supabase = createAdminClient();
  const { data: apiKey } = await supabase
    .from("api_keys")
    .select("id, key_hash, revoked_at")
    .eq("workspace_id", tool.workspace_id)
    .eq("key_prefix", token.slice(0, 24))
    .maybeSingle();

  const tokenHash = createHash("sha256").update(token).digest();
  const storedHash = apiKey ? Buffer.from(apiKey.key_hash, "hex") : Buffer.alloc(0);
  const validHash = storedHash.length === tokenHash.length && timingSafeEqual(storedHash, tokenHash);
  if (!apiKey || apiKey.revoked_at || !validHash) {
    return {
      apiKeyId: null,
      response: NextResponse.json({ error: "A valid bearer API key is required." }, { status: 401 }),
    };
  }

  return { apiKeyId: apiKey.id, response: null };
}

async function enforceWorkspaceQuota(
  supabase: ReturnType<typeof createAdminClient>,
  workspaceId: string,
  apiKeyId: string | null
) {
  const { data: usage, error } = await supabase.rpc("consume_gateway_call", {
    target_workspace_id: workspaceId,
    target_api_key_id: apiKeyId,
  });
  if (error || usage === null) {
    console.error("MockAgent: workspace usage check failed", error?.message);
    return NextResponse.json({ error: "Workspace usage could not be checked." }, { status: 503 });
  }
  if (usage < 0) {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1));
    const retryAfter = Math.max(1, Math.ceil((nextMonth.getTime() - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Monthly workspace or API key call limit reached." },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }
  return null;
}

function rateLimitUnavailable() {
  return NextResponse.json(
    { error: "Gateway rate limiting is unavailable." },
    { status: 503, headers: { "Retry-After": "30" } }
  );
}

function rateLimitExceeded(result: Awaited<ReturnType<typeof checkGatewayRateLimit>>) {
  const retryAfter = Math.max(1, Math.ceil((result.reset - Date.now()) / 1000));

  return NextResponse.json(
    { error: "Rate limit exceeded. Retry later.", retry_after_seconds: retryAfter },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.reset / 1000)),
      },
    }
  );
}

async function enforceClientRateLimit(request: NextRequest) {
  if (!isGatewayRateLimitConfigured()) {
    return process.env.NODE_ENV === "production" ? rateLimitUnavailable() : null;
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const clientIp =
    forwardedFor?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown";

  try {
    const result = await checkGatewayRateLimit("client", clientIp);
    return result.success ? null : rateLimitExceeded(result);
  } catch (error) {
    console.error("MockAgent: gateway client rate-limit check failed", error);
    return rateLimitUnavailable();
  }
}

async function enforceToolRateLimit(toolId: string) {
  try {
    const result = await checkGatewayRateLimit("tool", toolId);
    return result.success ? null : rateLimitExceeded(result);
  } catch (error) {
    console.error("MockAgent: gateway tool rate-limit check failed", error);
    return rateLimitUnavailable();
  }
}

/**
 * POST /api/v1/mock/[toolId]
 *
 * Called by an AI agent (or agent framework) executing a "tool call". The
 * request body is the tool's arguments. This route:
 *   1. Loads the tool's expected_json_schema + mock_response_body.
 *   2. Validates the incoming body against that schema with AJV.
 *   3. Logs the execution (SUCCESS or SCHEMA_VIOLATION) with latency.
 *   4. Returns the mock response (200) or validation errors (400) so the
 *      calling agent can self-correct and retry.
 *
 * This route intentionally does NOT require a Supabase session — external
 * agents are not dashboard users. It uses the service-role admin client to
 * read the tool definition and write the log row; RLS still protects reads
 * from the dashboard so users only ever see their own tools/logs.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const startedAt = performance.now();
  const { toolId } = await params;

  const clientRateLimitResponse = await enforceClientRateLimit(request);
  if (clientRateLimitResponse) return clientRateLimitResponse;

  if (!toolId) {
    return NextResponse.json({ error: "Missing toolId in path." }, { status: 400 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 }
    );
  }

  const runId = request.headers.get("x-mockagent-run-id")?.trim() || null;
  if (runId && (runId.length > 128 || /[\u0000-\u001f\u007f]/.test(runId))) {
    return NextResponse.json(
      { error: "x-mockagent-run-id must be at most 128 printable characters." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  const { data: tool, error: toolError } = await supabase
    .from("tools")
    .select("id, user_id, workspace_id, name, json_schema, mock_response, scenarios, is_active, require_api_key")
    .eq("id", toolId)
    .maybeSingle();

  if (toolError) {
    return NextResponse.json(
      { error: "Failed to load tool definition.", details: toolError.message },
      { status: 500 }
    );
  }

  if (!tool) {
    return NextResponse.json(
      { error: `No mock tool found for id "${toolId}".` },
      { status: 404 }
    );
  }

  if (!tool.is_active) {
    return NextResponse.json(
      { error: `Tool "${tool.name}" is currently disabled.` },
      { status: 409 }
    );
  }

  const apiKeyCheck = await enforceApiKey(request, tool);
  if (apiKeyCheck.response) return apiKeyCheck.response;

  const toolRateLimitResponse = await enforceToolRateLimit(tool.id);
  if (toolRateLimitResponse) return toolRateLimitResponse;

  const workspaceQuotaResponse = await enforceWorkspaceQuota(
    supabase,
    tool.workspace_id,
    apiKeyCheck.apiKeyId
  );
  if (workspaceQuotaResponse) return workspaceQuotaResponse;

  const { valid, errors } = validateAgainstSchema(
    tool.json_schema as Record<string, unknown>,
    payload
  );

  const scenarios = valid ? parseScenarios(tool.scenarios) : [];
  const scenario = valid ? resolveScenario(scenarios, payload) : null;
  const scenarioIndex = scenario ? scenarios.indexOf(scenario) : null;
  let scenarioStep: number | null = null;

  if (scenario?.responses) {
    let priorCalls = 0;
    if (runId && scenarioIndex !== null) {
      const { count, error } = await supabase
        .from("logs")
        .select("id", { count: "exact", head: true })
        .eq("tool_id", tool.id)
        .eq("run_id", runId)
        .eq("scenario_index", scenarioIndex)
        .eq("status", "SUCCESS");

      if (error) {
        console.error("MockAgent: failed to load scenario sequence state", error.message);
        return NextResponse.json(
          { error: "Could not load scenario sequence state." },
          { status: 503 }
        );
      }
      priorCalls = count ?? 0;
    }
    scenarioStep = Math.min(priorCalls + 1, scenario.responses.length);
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  const status: ExecutionStatus = valid ? "SUCCESS" : "SCHEMA_VIOLATION";
  const responseBody = valid
    ? scenario
      ? resolveScenarioResponse(scenario, scenarioStep ?? 1)
      : tool.mock_response
    : null;

  // Fire-and-forget-ish logging — we still await it so latency_ms in the log
  // reflects real gateway time, but a logging failure never blocks the
  // agent's response.
  const { error: logError } = await supabase.from("logs").insert({
    tool_id: tool.id,
    user_id: tool.user_id,
    payload: (payload ?? {}) as Json,
    workspace_id: tool.workspace_id,
    response_body: responseBody as Json | null,
    api_key_id: apiKeyCheck.apiKeyId,
    status,
    scenario_name: scenario?.name ?? null,
    scenario_index: scenarioIndex,
    scenario_step: scenarioStep,
    run_id: runId,
    error_details: valid
      ? null
      : (JSON.parse(JSON.stringify({ errors })) as Json),
    latency_ms: latencyMs,
  });

  if (logError) {
    console.error("MockAgent: failed to write execution log", logError.message);
  }

  if (!valid) {
    return NextResponse.json(
      {
        status: "SCHEMA_VIOLATION",
        tool: tool.name,
        message:
          "The provided arguments do not match this tool's expected_json_schema. Correct the fields below and retry.",
        errors,
        latency_ms: latencyMs,
      },
      { status: 400 }
    );
  }

  return NextResponse.json(responseBody, {
    status: 200,
    headers: {
      "x-mockagent-status": "SUCCESS",
      ...(scenario ? { "x-mockagent-scenario": scenario.name } : {}),
      ...(scenarioStep !== null ? { "x-mockagent-scenario-step": String(scenarioStep) } : {}),
      ...(runId ? { "x-mockagent-run-id": runId } : {}),
      "x-mockagent-latency-ms": String(latencyMs),
    },
  });
}

/**
 * GET is provided only as a lightweight health-check / schema preview so
 * developers can sanity-check a tool URL in a browser. Agents should always
 * call POST.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  const { toolId } = await params;
  const clientRateLimitResponse = await enforceClientRateLimit(request);
  if (clientRateLimitResponse) return clientRateLimitResponse;

  const supabase = createAdminClient();
  const { data: tool, error } = await supabase
    .from("tools")
    .select("id, user_id, workspace_id, name, description, json_schema, is_active, require_api_key")
    .eq("id", toolId)
    .maybeSingle();

  if (error || !tool) {
    return NextResponse.json({ error: "Tool not found." }, { status: 404 });
  }

  const apiKeyCheck = await enforceApiKey(request, tool);
  if (apiKeyCheck.response) return apiKeyCheck.response;

  const toolRateLimitResponse = await enforceToolRateLimit(tool.id);
  if (toolRateLimitResponse) return toolRateLimitResponse;

  return NextResponse.json({
    tool: tool.name,
    description: tool.description,
    is_active: tool.is_active,
    require_api_key: tool.require_api_key,
    expected_json_schema: tool.json_schema,
    usage: "POST tool-call arguments as JSON to this same URL.",
  });
}
