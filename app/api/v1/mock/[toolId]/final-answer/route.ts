import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  enforceApiKey,
  enforceClientRateLimit,
  enforceToolRateLimit,
  enforceWorkspaceQuota,
} from "@/lib/gateway-guards";
import {
  evaluateFinalAnswer,
  parseFinalAnswerAssertions,
} from "@/lib/final-answer-assertions";
import {
  evaluateSemanticAnswer,
  parseSemanticCriteria,
  type SemanticCallEvidence,
} from "@/lib/semantic-evaluation";
import type { Json } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface RouteParams {
  params: Promise<{ toolId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const { toolId } = await params;
  if (!toolId) {
    return NextResponse.json({ error: "Missing toolId in path." }, { status: 400 });
  }

  const clientRateLimitResponse = await enforceClientRateLimit(request);
  if (clientRateLimitResponse) return clientRateLimitResponse;

  const runId = request.headers.get("x-mockagent-run-id")?.trim();
  if (!runId || runId.length > 128 || /[\u0000-\u001f\u007f]/.test(runId)) {
    return NextResponse.json(
      { error: "A printable x-mockagent-run-id of at most 128 characters is required." },
      { status: 400 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }
  const answer = (body as Record<string, unknown>).final_answer;
  if (typeof answer !== "string" || !answer.trim() || answer.length > 30000) {
    return NextResponse.json(
      { error: "final_answer must be non-empty text of at most 30,000 characters." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const { data: tool, error: toolError } = await supabase
    .from("tools")
    .select("id, user_id, workspace_id, is_active, require_api_key, final_answer_assertions, semantic_criteria")
    .eq("id", toolId)
    .maybeSingle();

  if (toolError) {
    return NextResponse.json({ error: "Failed to load tool definition." }, { status: 500 });
  }
  if (!tool) {
    return NextResponse.json({ error: `No mock tool found for id "${toolId}".` }, { status: 404 });
  }
  if (!tool.is_active) {
    return NextResponse.json({ error: "This tool is disabled." }, { status: 409 });
  }

  const apiKeyCheck = await enforceApiKey(request, tool);
  if (apiKeyCheck.response) return apiKeyCheck.response;
  const toolRateLimitResponse = await enforceToolRateLimit(tool.id);
  if (toolRateLimitResponse) return toolRateLimitResponse;

  let assertions;
  let semanticCriteria;
  try {
    assertions = parseFinalAnswerAssertions(tool.final_answer_assertions);
    semanticCriteria = parseSemanticCriteria(tool.semantic_criteria);
  } catch (error) {
    console.error("MockAgent: invalid answer QA configuration", error);
    return NextResponse.json({ error: "Tool has invalid answer QA configuration." }, { status: 500 });
  }
  if (assertions.length === 0 && !semanticCriteria) {
    return NextResponse.json({ error: "No answer QA criteria are configured for this tool." }, { status: 409 });
  }

  const { count: matchingCalls, error: callLookupError } = await supabase
    .from("logs")
    .select("id", { count: "exact", head: true })
    .eq("tool_id", tool.id)
    .eq("run_id", runId);
  if (callLookupError) {
    return NextResponse.json({ error: "Could not verify the tool-call run." }, { status: 500 });
  }
  if (!matchingCalls) {
    return NextResponse.json(
      { error: "No tool calls were found for this run ID and tool." },
      { status: 409 }
    );
  }

  let toolCalls: string[] = [];
  if (assertions.some((assertion) => assertion.type === "tool_sequence")) {
    const { data: runLogs, count: runCallCount, error: runLogsError } = await supabase
      .from("logs")
      .select("id,tool_id,created_at", { count: "exact" })
      .eq("workspace_id", tool.workspace_id)
      .eq("run_id", runId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(501);
    if (runLogsError) {
      return NextResponse.json({ error: "Could not load the tool-call sequence for this run." }, { status: 500 });
    }
    if ((runCallCount ?? 0) > 500) {
      return NextResponse.json(
        { error: "Tool-sequence checks support runs with at most 500 tool calls." },
        { status: 413 }
      );
    }

    const toolIds = [...new Set((runLogs ?? []).map((log) => log.tool_id))];
    const { data: runTools, error: runToolsError } = toolIds.length
      ? await supabase.from("tools").select("id,name").in("id", toolIds)
      : { data: [], error: null };
    if (runToolsError) {
      return NextResponse.json({ error: "Could not load tool names for this run." }, { status: 500 });
    }
    const toolNameById = new Map((runTools ?? []).map((runTool) => [runTool.id, runTool.name]));
    const resolvedToolCalls: string[] = [];
    for (const log of runLogs ?? []) {
      const toolName = toolNameById.get(log.tool_id);
      if (toolName === undefined) {
        console.error("MockAgent: run log references an unavailable tool", log.tool_id);
        return NextResponse.json({ error: "A tool in this run could not be resolved." }, { status: 500 });
      }
      resolvedToolCalls.push(toolName);
    }
    toolCalls = resolvedToolCalls;
  }

  let semanticEvidence: SemanticCallEvidence[] = [];
  if (semanticCriteria) {
    const { data: successfulCalls, error: evidenceError } = await supabase
      .from("logs")
      .select("created_at, response_body, scenario_name, scenario_step")
      .eq("tool_id", tool.id)
      .eq("run_id", runId)
      .eq("status", "SUCCESS")
      .order("created_at", { ascending: true })
      .limit(50);
    if (evidenceError) {
      return NextResponse.json({ error: "Could not load semantic QA evidence." }, { status: 500 });
    }
    semanticEvidence = successfulCalls ?? [];
  }

  const quotaResponse = await enforceWorkspaceQuota(
    supabase,
    tool.workspace_id,
    apiKeyCheck.apiKeyId
  );
  if (quotaResponse) return quotaResponse;

  const assertionResults = evaluateFinalAnswer(assertions, answer, toolCalls);
  const literalPassed = assertionResults.length > 0
    ? assertionResults.every((result) => result.passed)
    : null;
  const passed = literalPassed ?? false;
  const semanticEvaluation = await evaluateSemanticAnswer(
    semanticCriteria,
    answer,
    semanticEvidence
  );
  const { error: insertError } = await supabase.from("final_answer_submissions").insert({
    tool_id: tool.id,
    user_id: tool.user_id,
    workspace_id: tool.workspace_id,
    api_key_id: apiKeyCheck.apiKeyId,
    run_id: runId,
    final_answer: answer,
    passed,
    assertion_results: assertionResults as unknown as Json,
    semantic_status: semanticEvaluation.status,
    semantic_result: semanticEvaluation as unknown as Json,
  });

  if (insertError) {
    console.error("MockAgent: failed to save final-answer assertions", insertError.message);
    return NextResponse.json({ error: "Could not save final-answer assertion results." }, { status: 500 });
  }

  return NextResponse.json({
    run_id: runId,
    passed,
    literal: {
      status: literalPassed === null ? "not_configured" : literalPassed ? "passed" : "failed",
      passed: literalPassed,
      results: assertionResults,
    },
    semantic: semanticEvaluation,
    results: assertionResults,
  });
}