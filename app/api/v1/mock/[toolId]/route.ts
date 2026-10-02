import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  enforceApiKey,
  enforceClientRateLimit,
  enforceToolRateLimit,
  enforceWorkspaceQuota,
} from "@/lib/gateway-guards";
import { validateAgainstSchema } from "@/lib/validators";
import { parseScenarios, resolveScenario, resolveScenarioResponse } from "@/lib/scenarios";
import type { ExecutionStatus, Json } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ toolId: string }>;
}

function normalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeJson((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

/**
 * POST /api/v1/mock/[toolId]
 *
 * Called by an AI agent (or agent framework) executing a "tool call". The
 * request body is the tool's arguments. This route:
 *   1. Loads the tool's expected_json_schema + mock_response_body.
 *   2. Validates the incoming body against that schema with AJV.
 *   3. Logs the execution (SUCCESS or SCHEMA_VIOLATION) with latency.
 *   4. Returns the mock response (200) or structured validation errors (400).
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
    return NextResponse.json(
      {
        error_code: "MISSING_TOOL_ID",
        error_class: "PERMANENT",
        error: "Missing toolId in path.",
        retryable: false,
      },
      { status: 400 }
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      {
        error_code: "INVALID_JSON",
        error_class: "VALIDATION",
        error: "Request body must be valid JSON.",
        retryable: false,
      },
      { status: 400 }
    );
  }

  const runId = request.headers.get("x-mockagent-run-id")?.trim() || null;
  if (runId && (runId.length > 128 || /[\u0000-\u001f\u007f]/.test(runId))) {
    return NextResponse.json(
      {
        error_code: "INVALID_RUN_ID",
        error_class: "VALIDATION",
        error: "x-mockagent-run-id must be at most 128 printable characters.",
        retryable: false,
      },
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
      {
        error_code: "TOOL_LOOKUP_FAILED",
        error_class: "TRANSIENT",
        error: "Failed to load tool definition.",
        details: toolError.message,
        retryable: true,
        retry_after_seconds: 1,
      },
      { status: 503, headers: { "Retry-After": "1" } }
    );
  }

  if (!tool) {
    return NextResponse.json(
      {
        error_code: "TOOL_NOT_FOUND",
        error_class: "PERMANENT",
        error: `No mock tool found for id "${toolId}".`,
        retryable: false,
      },
      { status: 404 }
    );
  }

  if (!tool.is_active) {
    return NextResponse.json(
      {
        error_code: "TOOL_DISABLED",
        error_class: "PERMANENT",
        error: `Tool "${tool.name}" is currently disabled.`,
        retryable: false,
      },
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
  const errorClass = valid
    ? null
    : errors?.some((validationError) => validationError.keyword === "invalidSchema")
      ? "PERMANENT"
      : "VALIDATION";
  const errorCode = errorClass === "PERMANENT"
    ? "TOOL_SCHEMA_INVALID"
    : "SCHEMA_VALIDATION_FAILED";
  const failureFingerprint = valid
    ? null
    : createHash("sha256")
        .update(`${tool.id}:${errorClass}:${JSON.stringify(normalizeJson(payload))}`)
        .digest("hex");
  let priorIdenticalFailures = 0;

  if (!valid && runId && failureFingerprint) {
    const { count, error } = await supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .eq("tool_id", tool.id)
      .eq("run_id", runId)
      .eq("failure_fingerprint", failureFingerprint)
      .eq("status", "SCHEMA_VIOLATION");

    if (error) {
      console.error("MockAgent: failed to check repeated validation failure", error.message);
      return NextResponse.json(
        {
          error_code: "FAILURE_HISTORY_UNAVAILABLE",
          error_class: "TRANSIENT",
          message: "Could not check this run's prior validation failures.",
          retryable: true,
          retry_after_seconds: 1,
        },
        { status: 503, headers: { "Retry-After": "1" } }
      );
    }
    priorIdenticalFailures = count ?? 0;
  }

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
          {
            error_code: "SCENARIO_STATE_UNAVAILABLE",
            error_class: "TRANSIENT",
            error: "Could not load scenario sequence state.",
            retryable: true,
            retry_after_seconds: 1,
          },
          { status: 503, headers: { "Retry-After": "1" } }
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
    failure_fingerprint: failureFingerprint,
    error_details: valid
      ? null
      : (JSON.parse(
          JSON.stringify({
            error_code: errorCode,
            error_class: errorClass,
            failure_fingerprint: failureFingerprint,
            errors,
          })
        ) as Json),
    latency_ms: latencyMs,
  });

  if (logError) {
    console.error("MockAgent: failed to write execution log", logError.message);
  }

  if (!valid) {
    const repeatedFailure = errorClass !== "PERMANENT" && priorIdenticalFailures > 0;
    const retryable = errorClass === "VALIDATION" && !repeatedFailure;
    return NextResponse.json(
      {
        status: errorClass === "PERMANENT"
          ? "TOOL_SCHEMA_INVALID"
          : repeatedFailure
            ? "REPEATED_VALIDATION_FAILURE"
            : "SCHEMA_VIOLATION",
        error_code: repeatedFailure
          ? "REPEATED_VALIDATION_FAILURE"
          : errorCode,
        error_class: errorClass,
        tool: tool.name,
        message: errorClass === "PERMANENT"
          ? "This tool has an invalid JSON Schema configuration. The tool owner must fix its schema before it can be called."
          : repeatedFailure
            ? "This identical invalid tool call has already failed in this run. Do not retry it again; correct the arguments or stop."
            : "The provided arguments do not match this tool's expected_json_schema. Correct the reported fields before retrying.",
        errors,
        failure_fingerprint: failureFingerprint,
        retryable,
        ...(runId ? { identical_failure_count: priorIdenticalFailures + 1 } : {}),
        latency_ms: latencyMs,
      },
      { status: errorClass === "PERMANENT" ? 500 : repeatedFailure ? 409 : 400 }
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
