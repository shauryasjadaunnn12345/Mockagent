import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  checkGatewayRateLimit,
  isGatewayRateLimitConfigured,
} from "@/lib/rate-limit";
import { validateAgainstSchema } from "@/lib/validators";
import type { ExecutionStatus, Json } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ toolId: string }>;
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

  const supabase = createAdminClient();

  const { data: tool, error: toolError } = await supabase
    .from("tools")
    .select("id, user_id, name, json_schema, mock_response, is_active")
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

  const toolRateLimitResponse = await enforceToolRateLimit(tool.id);
  if (toolRateLimitResponse) return toolRateLimitResponse;

  if (!tool.is_active) {
    return NextResponse.json(
      { error: `Tool "${tool.name}" is currently disabled.` },
      { status: 409 }
    );
  }

  const { valid, errors } = validateAgainstSchema(
    tool.json_schema as Record<string, unknown>,
    payload
  );

  const latencyMs = Math.round(performance.now() - startedAt);
  const status: ExecutionStatus = valid ? "SUCCESS" : "SCHEMA_VIOLATION";

  // Fire-and-forget-ish logging — we still await it so latency_ms in the log
  // reflects real gateway time, but a logging failure never blocks the
  // agent's response.
  const { error: logError } = await supabase.from("logs").insert({
    tool_id: tool.id,
    user_id: tool.user_id,
    payload: (payload ?? {}) as Json,
    status,
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

  return NextResponse.json(tool.mock_response, {
    status: 200,
    headers: {
      "x-mockagent-status": "SUCCESS",
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
    .select("id, name, description, json_schema, is_active")
    .eq("id", toolId)
    .maybeSingle();

  if (error || !tool) {
    return NextResponse.json({ error: "Tool not found." }, { status: 404 });
  }

  const toolRateLimitResponse = await enforceToolRateLimit(tool.id);
  if (toolRateLimitResponse) return toolRateLimitResponse;

  return NextResponse.json({
    tool: tool.name,
    description: tool.description,
    is_active: tool.is_active,
    expected_json_schema: tool.json_schema,
    usage: "POST tool-call arguments as JSON to this same URL.",
  });
}
