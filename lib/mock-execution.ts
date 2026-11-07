import { createHash } from "node:crypto";
import {
  validateAgainstSchema,
} from "./validators.ts";
import { validateAgainstSchemaWithTimeout } from "./mcp-validation.ts";
import {
  evaluateCallGuards,
  parseFinalAnswerAssertions,
  type CallGuardResult,
} from "./final-answer-assertions.ts";
import {
  parseScenarios,
  resolveScenario,
  resolveScenarioResponse,
  resolveScenarioStep,
} from "./scenarios.ts";
import type { ExecutionStatus, Json } from "../types/database";
import type { createAdminClient } from "./supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface MockToolConfiguration {
  id: string;
  user_id: string;
  workspace_id: string;
  name: string;
  json_schema: unknown;
  mock_response: unknown;
  scenarios: unknown;
  final_answer_assertions?: unknown;
}

export interface MockExecutionContext {
  supabase: AdminClient;
  tool: MockToolConfiguration;
  arguments: unknown;
  runId: string | null;
  apiKeyId: string | null;
  startedAt: number;
  transport?: "http" | "mcp";
  toolsetId?: string | null;
  jsonRpcMethod?: string | null;
  traceparent?: string | null;
  signal?: AbortSignal;
  maxResponseBytes?: number;
  measureResponseSize?: (responseBody: unknown) => number;
}

export interface MockExecutionResult {
  valid: boolean;
  errors: unknown[] | null;
  errorClass: "VALIDATION" | "PERMANENT" | null;
  errorCode: string | null;
  responseBody: unknown;
  status: ExecutionStatus;
  scenarioName: string | null;
  scenarioIndex: number | null;
  scenarioStep: number | null;
  injectedFailure: {
    status: number;
    message: string;
    retryAfterSeconds?: number;
    errorCode: string;
  } | null;
  failureFingerprint: string | null;
  latencyMs: number;
  repeatedFailureCount: number;
  gatewayError: { status: number; code: string; message: string } | null;
  policyViolations: CallGuardResult[];
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

function gatewayError(status: number, code: string, message: string): MockExecutionResult {
  return {
    valid: false,
    errors: null,
    errorClass: null,
    errorCode: code,
    responseBody: null,
    status: "INJECTED_FAILURE",
    scenarioName: null,
    scenarioIndex: null,
    scenarioStep: null,
    injectedFailure: null,
    failureFingerprint: null,
    latencyMs: 0,
    repeatedFailureCount: 0,
    gatewayError: { status, code, message },
    policyViolations: [],
  };
}

export async function executeMockTool(context: MockExecutionContext): Promise<MockExecutionResult> {
  const {
    supabase,
    tool,
    arguments: payload,
    runId,
    apiKeyId,
    startedAt,
  } = context;
  const schema = tool.json_schema as Record<string, unknown>;
  const validation = context.transport === "mcp"
    ? await validateAgainstSchemaWithTimeout(schema, payload)
    : validateAgainstSchema(schema, payload);
  const { valid, errors } = validation;
  const errorClass = valid
    ? null
    : errors?.some((validationError) => validationError.keyword === "invalidSchema")
      ? "PERMANENT"
      : "VALIDATION";
  const errorCode = errorClass === "PERMANENT"
    ? "TOOL_SCHEMA_INVALID"
    : errorClass === "VALIDATION"
      ? "SCHEMA_VALIDATION_FAILED"
      : null;
  const policyViolations = valid
    ? evaluateCallGuards(
        parseFinalAnswerAssertions(tool.final_answer_assertions ?? []),
        payload
      ).filter((assertion) => !assertion.passed)
    : [];
  const policyFailure = policyViolations.length > 0;
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
      .eq("status", "SCHEMA_VIOLATION")
      .abortSignal(context.signal ?? AbortSignal.timeout(10_000));
    if (error) {
      console.error("MockAgent: failed to check repeated validation failure", error.message);
      return gatewayError(503, "FAILURE_HISTORY_UNAVAILABLE", "Could not check prior validation failures.");
    }
    priorIdenticalFailures = count ?? 0;
  }

  let scenario: ReturnType<typeof parseScenarios>[number] | null = null;
  let scenarioIndex: number | null = null;
  let scenarioStep: number | null = null;
  let scenarioAttempt: number | null = null;
  let injectedFailure: MockExecutionResult["injectedFailure"] = null;
  if (valid && !policyFailure) {
    const scenarios = parseScenarios(tool.scenarios);
    scenario = resolveScenario(scenarios, payload);
    scenarioIndex = scenario ? scenarios.indexOf(scenario) : null;
    if (scenario?.responses || scenario?.failures?.length) {
      let priorCalls = 0;
      if (runId && scenarioIndex !== null) {
        const { count, error } = await supabase
          .from("logs")
          .select("id", { count: "exact", head: true })
          .eq("tool_id", tool.id)
          .eq("run_id", runId)
          .eq("scenario_index", scenarioIndex)
          .abortSignal(context.signal ?? AbortSignal.timeout(10_000));
        if (error) {
          console.error("MockAgent: failed to load scenario sequence state", error.message);
          return gatewayError(503, "SCENARIO_STATE_UNAVAILABLE", "Could not load scenario sequence state.");
        }
        priorCalls = count ?? 0;
      }
      const step = resolveScenarioStep(scenario, priorCalls);
      scenarioAttempt = step.attempt;
      scenarioStep = step.responseStep;
      if (step.failure) {
        injectedFailure = {
          status: step.failure.status,
          message: step.failure.message,
          ...(step.failure.retryAfterSeconds === undefined
            ? {}
            : { retryAfterSeconds: step.failure.retryAfterSeconds }),
          errorCode: step.failure.errorCode,
        };
      }
    }
  }

  const loggedScenarioStep = injectedFailure ? scenarioAttempt : scenarioStep;
  const latencyMs = Math.round(performance.now() - startedAt);
  let responseBody = policyFailure
    ? {
        error_code: "SAFETY_GUARD_BLOCKED",
        error_class: "POLICY",
        message: "The call was blocked by a configured safety rule.",
        violations: policyViolations.map(({ name, path, message }) => ({ name, path, message })),
        retryable: false,
      }
    : valid
    ? scenario
      ? injectedFailure
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
        : resolveScenarioResponse(scenario, scenarioStep ?? 1)
      : tool.mock_response
    : null;
  if (valid && context.maxResponseBytes !== undefined && responseBody !== null) {
    const responseSize = context.measureResponseSize
      ? context.measureResponseSize(responseBody)
      : Buffer.byteLength(JSON.stringify(responseBody), "utf8");
    if (responseSize > context.maxResponseBytes) {
      injectedFailure = {
        status: 500,
        errorCode: "MCP_RESULT_TOO_LARGE",
        message: "The mock result exceeds the MCP response-size limit.",
      };
      responseBody = {
        status: "INJECTED_FAILURE",
        error_code: injectedFailure.errorCode,
        error_class: "TRANSIENT",
        message: injectedFailure.message,
        retryable: false,
      };
    }
  }
  const status: ExecutionStatus = policyFailure
    ? "POLICY_VIOLATION"
    : !valid
      ? "SCHEMA_VIOLATION"
      : injectedFailure
      ? "INJECTED_FAILURE"
      : "SUCCESS";
  const failureBody = injectedFailure
    ? {
        status: "INJECTED_FAILURE",
        error_code: injectedFailure.errorCode,
        error_class: "TRANSIENT",
        message: injectedFailure.message,
        retryable: injectedFailure.errorCode !== "MCP_RESULT_TOO_LARGE",
        ...(injectedFailure.retryAfterSeconds === undefined
          ? {}
          : { retry_after_seconds: injectedFailure.retryAfterSeconds }),
      }
    : null;

  const { error: logError } = await supabase.from("logs").insert({
    tool_id: tool.id,
    toolset_id: context.toolsetId ?? null,
    user_id: tool.user_id,
    payload: (payload ?? {}) as Json,
    workspace_id: tool.workspace_id,
    response_body: responseBody as Json | null,
    api_key_id: apiKeyId,
    status,
    transport: context.transport ?? "http",
    jsonrpc_method: context.jsonRpcMethod ?? null,
    mcp_tool_name: context.transport === "mcp" ? tool.name : null,
    traceparent: context.traceparent ?? null,
    scenario_name: scenario?.name ?? null,
    scenario_index: scenarioIndex,
    scenario_step: loggedScenarioStep,
    run_id: runId,
    failure_fingerprint: failureFingerprint,
    error_details: policyFailure
      ? ({ error_code: "SAFETY_GUARD_BLOCKED", violations: policyViolations } as unknown as Json)
      : valid
      ? injectedFailure
        ? (failureBody as Json)
        : null
      : (JSON.parse(
          JSON.stringify({
            error_code: errorCode,
            error_class: errorClass,
            failure_fingerprint: failureFingerprint,
            errors,
          })
        ) as Json),
    latency_ms: latencyMs,
  }).abortSignal(context.signal ?? AbortSignal.timeout(10_000));
  if (logError) console.error("MockAgent: failed to write execution log", logError.message);

  return {
    valid,
    errors,
    errorClass,
    errorCode,
    responseBody,
    status,
    scenarioName: scenario?.name ?? null,
    scenarioIndex,
    scenarioStep: loggedScenarioStep,
    injectedFailure,
    failureFingerprint,
    latencyMs,
    repeatedFailureCount: priorIdenticalFailures,
    gatewayError: null,
    policyViolations,
  };
}
