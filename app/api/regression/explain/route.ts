import { NextResponse, type NextRequest } from "next/server";
import { enforceAIRequestBudget } from "@/lib/ai-usage";
import { aiMonthlyRequestLimit } from "@/lib/billing";
import { explainRegressionFailure, getMetaConfig } from "@/lib/meta-ai";
import { parseRegressionFailureExplanation } from "@/lib/regression-ai";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

interface FailedCheck {
  name: string;
  passed: false;
  expected: string | string[];
  actual: string | string[];
}

function readFailedChecks(value: Json): FailedCheck[] | null {
  if (!Array.isArray(value)) return null;
  const checks: FailedCheck[] = [];
  for (const check of value) {
    if (
      !isRecord(check) ||
      typeof check.name !== "string" ||
      check.passed !== false ||
      !(typeof check.expected === "string" || Array.isArray(check.expected)) ||
      !(typeof check.actual === "string" || Array.isArray(check.actual))
    ) continue;
    checks.push({
      name: check.name,
      passed: false,
      expected: check.expected as string | string[],
      actual: check.actual as string | string[],
    });
  }
  return checks;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to explain a regression failure." }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.runRecordId !== "string" || !/^[0-9a-f-]{36}$/i.test(body.runRecordId)) {
    return NextResponse.json({ error: "A valid saved regression run ID is required." }, { status: 400 });
  }

  const { data: run, error: runError } = await supabase
    .from("agent_test_runs")
    .select("id,workspace_id,status,checks,trace")
    .eq("id", body.runRecordId)
    .maybeSingle();
  if (runError) {
    console.error("MockAgent failure explanation: failed to load run", runError.message);
    return NextResponse.json({ error: "Could not load the regression run." }, { status: 500 });
  }
  if (!run) return NextResponse.json({ error: "Regression run not found." }, { status: 404 });
  if (run.status !== "failed") {
    return NextResponse.json({ error: "Only failed regression runs can be explained." }, { status: 409 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", run.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError || !membership) {
    console.error("MockAgent failure explanation: workspace membership could not be verified", membershipError?.message);
    return NextResponse.json({ error: "You do not have access to this regression run." }, { status: 403 });
  }

  const failedChecks = readFailedChecks(run.checks);
  if (!failedChecks?.length) {
    return NextResponse.json({ error: "This run has no readable failed checks to explain." }, { status: 409 });
  }
  const { configured, model } = getMetaConfig();
  if (!configured) return NextResponse.json({ error: "Meta AI is not configured." }, { status: 503 });

  const admin = createAdminClient();
  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .select("plan,subscription_status")
    .eq("id", run.workspace_id)
    .maybeSingle();
  if (workspaceError || !workspace) {
    console.error("MockAgent failure explanation: failed to load workspace plan", workspaceError?.message);
    return NextResponse.json({ error: "Could not load your workspace plan." }, { status: 500 });
  }
  const aiRequestLimit = aiMonthlyRequestLimit(workspace.plan, workspace.subscription_status);
  const budget = await enforceAIRequestBudget(admin, run.workspace_id);
  if (budget.response) return budget.response;

  try {
    const trace = JSON.stringify(run.trace ?? {}).slice(0, 12_000);
    const explanation = parseRegressionFailureExplanation(
      await explainRegressionFailure({ failedChecks, trace }),
      failedChecks.map((check) => check.name)
    );
    return NextResponse.json({
      explanation,
      model,
      aiUsage: { used: budget.used, limit: aiRequestLimit },
    });
  } catch (error) {
    console.error(
      "MockAgent failure explanation: Meta AI explanation or validation failed",
      error instanceof Error ? error.message : error
    );
    return NextResponse.json(
      {
        error: "Could not create an evidence-linked failure explanation. Try again later.",
        aiUsage: { used: budget.used, limit: aiRequestLimit },
      },
      { status: 502 }
    );
  }
}
