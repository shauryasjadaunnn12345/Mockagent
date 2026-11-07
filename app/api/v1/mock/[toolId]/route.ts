import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  enforceApiKey,
  enforceClientRateLimit,
  enforceToolRateLimit,
  enforceWorkspaceQuota,
} from "@/lib/gateway-guards";
import { assertRunToolSnapshotBundle } from "@/lib/run-snapshots";
import { executeMockTool } from "@/lib/mock-execution";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ toolId: string }>;
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
    .select("id, user_id, workspace_id, name, json_schema, mock_response, scenarios, final_answer_assertions, is_active, require_api_key")
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

  let toolConfiguration: {
    name: string;
    json_schema: unknown;
    mock_response: unknown;
    scenarios: unknown;
    final_answer_assertions: unknown;
  } = {
    name: tool.name,
    json_schema: tool.json_schema,
    mock_response: tool.mock_response,
    scenarios: tool.scenarios,
    final_answer_assertions: tool.final_answer_assertions,
  };
  const snapshotToken = request.headers.get("x-mockagent-config-token");
  if (snapshotToken) {
    if (!runId || !/^[0-9a-f]{64}$/.test(snapshotToken)) {
      return NextResponse.json(
        { error_code: "INVALID_CONFIG_SNAPSHOT", error: "Run configuration snapshot token is invalid." },
        { status: 400 }
      );
    }
    const tokenHash = createHash("sha256").update(snapshotToken).digest("hex");
    const { data: override, error: overrideError } = await supabase
      .from("agent_run_config_overrides")
      .select("run_id,workspace_id,tool_ids,tool_snapshots,expires_at")
      .eq("token_hash", tokenHash)
      .maybeSingle();
    if (overrideError) {
      console.error("MockAgent: failed to load run configuration snapshot", overrideError.message);
      return NextResponse.json(
        { error_code: "CONFIG_SNAPSHOT_UNAVAILABLE", error: "Could not load the saved run configuration." },
        { status: 503 }
      );
    }
    if (
      !override ||
      override.run_id !== runId ||
      override.workspace_id !== tool.workspace_id ||
      Date.parse(override.expires_at) <= Date.now()
    ) {
      return NextResponse.json(
        { error_code: "INVALID_CONFIG_SNAPSHOT", error: "Run configuration snapshot is expired or does not match this tool." },
        { status: 403 }
      );
    }
    try {
      assertRunToolSnapshotBundle(override.tool_snapshots, override.tool_ids);
      const savedTool = override.tool_snapshots.tools.find((snapshot) => snapshot.id === tool.id);
      if (!savedTool) throw new Error("Requested tool is not included in the saved run snapshot.");
      toolConfiguration = {
        name: savedTool.name,
        json_schema: savedTool.json_schema,
        mock_response: savedTool.mock_response,
        scenarios: savedTool.scenarios,
        final_answer_assertions: savedTool.final_answer_assertions,
      };
    } catch (error) {
      console.error(
        "MockAgent: invalid saved run configuration",
        error instanceof Error ? error.message : error
      );
      return NextResponse.json(
        { error_code: "INVALID_CONFIG_SNAPSHOT", error: "Saved run configuration is invalid." },
        { status: 409 }
      );
    }
  }

  const execution = await executeMockTool({
    supabase,
    tool: {
      id: tool.id,
      user_id: tool.user_id,
      workspace_id: tool.workspace_id,
      name: toolConfiguration.name,
      json_schema: toolConfiguration.json_schema,
      mock_response: toolConfiguration.mock_response,
      scenarios: toolConfiguration.scenarios,
      final_answer_assertions: toolConfiguration.final_answer_assertions,
    },
    arguments: payload,
    runId,
    apiKeyId: apiKeyCheck.apiKeyId,
    startedAt,
  });
  if (execution.gatewayError) {
    return NextResponse.json(
      {
        error_code: execution.gatewayError.code,
        error_class: "TRANSIENT",
        error: execution.gatewayError.message,
        retryable: true,
        retry_after_seconds: 1,
      },
      { status: execution.gatewayError.status, headers: { "Retry-After": "1" } }
    );
  }
  const {
    valid,
    errors,
    errorClass,
    errorCode,
    failureFingerprint,
    responseBody,
    latencyMs,
    scenarioName,
    scenarioStep,
    injectedFailure,
    repeatedFailureCount,
  } = execution;
  if (execution.policyViolations.length > 0) {
    return NextResponse.json(responseBody, {
      status: 403,
      headers: {
        "x-mockagent-status": "POLICY_VIOLATION",
        ...(runId ? { "x-mockagent-run-id": runId } : {}),
        "x-mockagent-latency-ms": String(latencyMs),
      },
    });
  }
  const failureBody = injectedFailure
    ? {
        status: "INJECTED_FAILURE",
        error_code: injectedFailure.errorCode,
        error_class: "TRANSIENT",
        message: injectedFailure.message,
        retryable: true,
        ...(injectedFailure.retryAfterSeconds === undefined
          ? {}
          : { retry_after_seconds: injectedFailure.retryAfterSeconds }),
      }
    : null;

  if (!valid) {
    const repeatedFailure = errorClass !== "PERMANENT" && repeatedFailureCount > 0;
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
        tool: toolConfiguration.name,
        message: errorClass === "PERMANENT"
          ? "This tool has an invalid JSON Schema configuration. The tool owner must fix its schema before it can be called."
          : repeatedFailure
            ? "This identical invalid tool call has already failed in this run. Do not retry it again; correct the arguments or stop."
            : "The provided arguments do not match this tool's expected_json_schema. Correct the reported fields before retrying.",
        errors,
        failure_fingerprint: failureFingerprint,
        retryable,
        ...(runId ? { identical_failure_count: repeatedFailureCount + 1 } : {}),
        latency_ms: latencyMs,
      },
      { status: errorClass === "PERMANENT" ? 500 : repeatedFailure ? 409 : 400 }
    );
  }

  if (injectedFailure && failureBody) {
    return NextResponse.json(failureBody, {
      status: injectedFailure.status,
      headers: {
        "x-mockagent-status": "INJECTED_FAILURE",
        ...(scenarioName ? { "x-mockagent-scenario": scenarioName } : {}),
        ...(scenarioStep !== null ? { "x-mockagent-scenario-step": String(scenarioStep) } : {}),
        ...(runId ? { "x-mockagent-run-id": runId } : {}),
        ...(injectedFailure.retryAfterSeconds === undefined
          ? {}
          : { "Retry-After": String(injectedFailure.retryAfterSeconds) }),
        "x-mockagent-latency-ms": String(latencyMs),
      },
    });
  }

  return NextResponse.json(responseBody, {
    status: 200,
    headers: {
      "x-mockagent-status": "SUCCESS",
      ...(scenarioName ? { "x-mockagent-scenario": scenarioName } : {}),
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
