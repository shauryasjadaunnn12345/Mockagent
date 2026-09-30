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
    .select("id, user_id, workspace_id, is_active, require_api_key, final_answer_assertions")
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
  try {
    assertions = parseFinalAnswerAssertions(tool.final_answer_assertions);
  } catch (error) {
    console.error("MockAgent: invalid final-answer assertions", error);
    return NextResponse.json({ error: "Tool has invalid final-answer assertions." }, { status: 500 });
  }
  if (assertions.length === 0) {
    return NextResponse.json({ error: "No final-answer assertions are configured for this tool." }, { status: 409 });
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

  const quotaResponse = await enforceWorkspaceQuota(
    supabase,
    tool.workspace_id,
    apiKeyCheck.apiKeyId
  );
  if (quotaResponse) return quotaResponse;

  const assertionResults = evaluateFinalAnswer(assertions, answer);
  const passed = assertionResults.every((result) => result.passed);
  const { error: insertError } = await supabase.from("final_answer_submissions").insert({
    tool_id: tool.id,
    user_id: tool.user_id,
    workspace_id: tool.workspace_id,
    api_key_id: apiKeyCheck.apiKeyId,
    run_id: runId,
    final_answer: answer,
    passed,
    assertion_results: assertionResults as unknown as Json,
  });

  if (insertError) {
    console.error("MockAgent: failed to save final-answer assertions", insertError.message);
    return NextResponse.json({ error: "Could not save final-answer assertion results." }, { status: 500 });
  }

  return NextResponse.json({
    run_id: runId,
    passed,
    results: assertionResults,
  });
}