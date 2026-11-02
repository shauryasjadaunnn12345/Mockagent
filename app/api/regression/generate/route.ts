import { NextResponse, type NextRequest } from "next/server";
import { enforceAIRequestBudget } from "@/lib/ai-usage";
import { aiMonthlyRequestLimit } from "@/lib/billing";
import {
  generateRegressionTestCases,
  getMetaConfig,
  reviewRegressionContracts,
} from "@/lib/meta-ai";
import {
  collectRegressionContractReferences,
  parseGeneratedRegressionTestCases,
  parseRegressionContractReview,
} from "@/lib/regression-ai";
import {
  analyzeRegressionCoverage,
  prioritizeRegressionCoverageGaps,
} from "@/lib/regression-coverage";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to generate regression cases." }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_000) {
    return NextResponse.json({ error: "Generation request is too large." }, { status: 413 });
  }
  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Could not read the request body." }, { status: 400 });
  }
  if (rawBody.length > 16_000) {
    return NextResponse.json({ error: "Generation request is too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }
  if (
    !isRecord(body) ||
    !Array.isArray(body.toolIds) ||
    body.toolIds.length < 1 ||
    body.toolIds.length > 250 ||
    !body.toolIds.every((id) => typeof id === "string" && id.length <= 64) ||
    new Set(body.toolIds).size !== body.toolIds.length ||
    (body.runRecordId !== undefined &&
      (typeof body.runRecordId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.runRecordId))) ||
    (body.hint !== undefined &&
      (typeof body.hint !== "string" || body.hint.length > 1000)) ||
    (body.coverageGuided !== undefined && typeof body.coverageGuided !== "boolean") ||
    (body.contractReview !== undefined && typeof body.contractReview !== "boolean")
  ) {
    return NextResponse.json(
      { error: "Select 1–250 unique tools and provide an optional hint of at most 1,000 characters." },
      { status: 400 }
    );
  }

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError) {
    console.error("MockAgent case generation: failed to load active workspace", settingsError.message);
    return NextResponse.json({ error: "Could not load your active workspace." }, { status: 500 });
  }
  const workspaceId = settings?.current_workspace_id;
  if (!workspaceId) {
    return NextResponse.json({ error: "No active workspace is configured." }, { status: 409 });
  }
  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError || !membership) {
    console.error("MockAgent case generation: workspace membership could not be verified", membershipError?.message);
    return NextResponse.json({ error: "Your active workspace could not be verified." }, { status: 403 });
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("plan,subscription_status")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError || !workspace) {
    console.error("MockAgent case generation: failed to load workspace plan", workspaceError?.message);
    return NextResponse.json({ error: "Could not load your workspace plan." }, { status: 500 });
  }
  const { configured, model } = getMetaConfig();
  if (!configured) {
    return NextResponse.json({ error: "Meta AI is not configured." }, { status: 503 });
  }

  const { data: tools, error: toolsError } = await supabase
    .from("tools")
    .select("id,name,description,json_schema,mock_response,scenarios,is_active")
    .eq("workspace_id", workspaceId)
    .in("id", body.toolIds);
  if (toolsError) {
    console.error("MockAgent case generation: failed to load selected tools", toolsError.message);
    return NextResponse.json({ error: "Could not load selected tools." }, { status: 500 });
  }
  if (tools?.length !== body.toolIds.length) {
    return NextResponse.json({ error: "Selected tools must belong to the active workspace." }, { status: 404 });
  }
  if (tools.some((tool) => !tool.is_active)) {
    return NextResponse.json({ error: "Regression cases can only use active tools." }, { status: 409 });
  }
  const serializedTools = JSON.stringify(tools);
  if (serializedTools.length > 32_000) {
    return NextResponse.json(
      { error: "Selected tool definitions exceed the 32 KB generation limit. Select fewer tools." },
      { status: 413 }
    );
  }

  let coverageTargets: Array<{ toolName: string; target: string }> = [];
  if (body.coverageGuided) {
    const { data: recentRuns, error: recentRunsError } = await supabase
      .from("agent_test_runs")
      .select("trace")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (recentRunsError) {
      console.error("MockAgent case generation: failed to load recent coverage traces", recentRunsError.message);
      return NextResponse.json({ error: "Could not load recent regression coverage." }, { status: 500 });
    }

    coverageTargets = prioritizeRegressionCoverageGaps(
      analyzeRegressionCoverage(tools, recentRuns ?? []).gaps,
    );
  }

  if (body.contractReview) {
    const aiRequestLimit = aiMonthlyRequestLimit(workspace.plan, workspace.subscription_status);
    const budget = await enforceAIRequestBudget(createAdminClient(), workspaceId);
    if (budget.response) return budget.response;

    try {
      const review = parseRegressionContractReview(
        await reviewRegressionContracts({
          tools,
          ...(coverageTargets.length > 0 ? { coverageTargets } : {}),
        }),
        tools.map((tool) => tool.name),
        collectRegressionContractReferences(tools),
      );
      return NextResponse.json({
        review,
        model,
        coverageTargetCount: coverageTargets.length,
        aiUsage: { used: budget.used, limit: aiRequestLimit },
      });
    } catch (error) {
      console.error(
        "MockAgent contract review: Meta analysis or validation failed",
        error instanceof Error ? error.message : error,
      );
      return NextResponse.json(
        {
          error: "Could not create a validated contract risk review. Try again later.",
          aiUsage: { used: budget.used, limit: aiRequestLimit },
        },
        { status: 502 },
      );
    }
  }

  let failureContext: { failedChecks: unknown[]; trace: string } | undefined;
  if (typeof body.runRecordId === "string") {
    const { data: sourceRun, error: sourceRunError } = await supabase
      .from("agent_test_runs")
      .select("workspace_id,status,checks,trace")
      .eq("id", body.runRecordId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (sourceRunError) {
      console.error("MockAgent case generation: failed to load source run", sourceRunError.message);
      return NextResponse.json({ error: "Could not load the source regression run." }, { status: 500 });
    }
    if (!sourceRun) {
      return NextResponse.json({ error: "Source run was not found in the active workspace." }, { status: 404 });
    }
    if (sourceRun.status !== "failed") {
      return NextResponse.json({ error: "Follow-up cases can only be generated from a failed run." }, { status: 409 });
    }
    const failedChecks = Array.isArray(sourceRun.checks)
      ? sourceRun.checks.filter((check) =>
          isRecord(check) && check.passed === false && typeof check.name === "string"
        )
      : [];
    if (failedChecks.length === 0) {
      return NextResponse.json({ error: "Source run has no readable failed checks." }, { status: 409 });
    }
    failureContext = {
      failedChecks,
      trace: JSON.stringify(sourceRun.trace ?? {}).slice(0, 12_000),
    };
  }

  const aiRequestLimit = aiMonthlyRequestLimit(workspace.plan, workspace.subscription_status);
  const budget = await enforceAIRequestBudget(createAdminClient(), workspaceId);
  if (budget.response) return budget.response;

  try {
    const generated = await generateRegressionTestCases({
      tools,
      hint: typeof body.hint === "string" ? body.hint.trim() : "",
      ...(coverageTargets.length > 0 ? { coverageTargets } : {}),
      ...(failureContext ? { failureContext } : {}),
    });
    const testCases = parseGeneratedRegressionTestCases(generated);
    return NextResponse.json({
      testCases,
      model,
      coverageTargetCount: coverageTargets.length,
      aiUsage: { used: budget.used, limit: aiRequestLimit },
    });
  } catch (error) {
    console.error(
      "MockAgent case generation: Meta AI generation or validation failed",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        error: error instanceof Error
          ? `Could not generate valid regression cases: ${error.message}`
          : "Could not generate valid regression cases.",
        aiUsage: { used: budget.used, limit: aiRequestLimit },
      },
      { status: 502 }
    );
  }
}
