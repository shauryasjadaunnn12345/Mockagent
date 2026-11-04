import { NextResponse } from "next/server";
import { enforceAIRequestBudget } from "@/lib/ai-usage";
import { aiMonthlyRequestLimit } from "@/lib/billing";
import { analyzeDemoFailure, getMetaConfig } from "@/lib/meta-ai";
import { DEMO_FAILED_CHECK, DEMO_FLAWED_AGENT_PROMPT, DEMO_TOOLS } from "@/lib/demo-mode";
import {
  parseGeneratedRegressionTestCases,
  parseRegressionFailureExplanation,
} from "@/lib/regression-ai";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getDemoFailureMessage(error: unknown, phase: string): string {
  const message = error instanceof Error ? error.message : "";
  const status = message.match(/Meta (?:AI|Model API) HTTP (\d{3})/)?.[1];
  if (status === "429") return "Meta AI is rate-limiting requests. Wait briefly, then run the demo again.";
  if (status === "401" || status === "403") {
    return "Meta AI rejected its configured credentials. Ask an administrator to check the API key.";
  }
  if (status && Number(status) >= 500) {
    return "The Meta AI service is temporarily unavailable. Try again later.";
  }
  if (status) {
    return `Meta AI rejected the request (HTTP ${status}). Check the configured model and provider settings.`;
  }
  if (/fetch failed|network|timed out|timeout/i.test(message)) {
    return "Could not reach the Meta AI provider. Check provider availability and try again.";
  }
  if (phase === "explanation validation") {
    return "Meta AI returned an explanation that did not validate against the failed check. Check server logs for details.";
  }
  if (phase === "regression draft validation") {
    return "Meta AI returned a regression draft that did not pass validation. Check server logs for details.";
  }
  return "Meta AI could not return a valid response. Check server logs for details, then try again.";
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to run the Meta-powered demo." }, { status: 401 });
  }

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError) {
    console.error("MockAgent demo: failed to load active workspace", settingsError.message);
    return NextResponse.json({ error: "Could not load your active workspace." }, { status: 500 });
  }
  const workspaceId = settings?.current_workspace_id;
  if (!workspaceId) {
    return NextResponse.json({ error: "Choose an active workspace before running the demo." }, { status: 409 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError || !membership) {
    console.error("MockAgent demo: workspace membership could not be verified", membershipError?.message);
    return NextResponse.json({ error: "Your active workspace could not be verified." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: workspace, error: workspaceError } = await admin
    .from("workspaces")
    .select("plan,subscription_status")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError || !workspace) {
    console.error("MockAgent demo: failed to load workspace plan", workspaceError?.message);
    return NextResponse.json({ error: "Could not load your workspace plan." }, { status: 500 });
  }
  const { configured, model } = getMetaConfig();
  if (!configured) {
    return NextResponse.json({ error: "Meta AI is not configured." }, { status: 503 });
  }

  const aiRequestLimit = aiMonthlyRequestLimit(workspace.plan, workspace.subscription_status);
  const budget = await enforceAIRequestBudget(admin, workspaceId);
  if (budget.response) return budget.response;

  let phase = "Meta AI request";
  try {
    const result = await analyzeDemoFailure({
      flawedAgentPrompt: DEMO_FLAWED_AGENT_PROMPT,
      tools: DEMO_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        json_schema: tool.json_schema,
        mock_response: tool.mock_response,
        scenarios: tool.scenarios,
      })),
      failedCheckName: DEMO_FAILED_CHECK,
      trace: {
        calls: [
          { toolName: "lookup_order", arguments: { order_id: "demo-42" }, response: { status: "pending" }, status: 200 },
          { toolName: "issue_refund", arguments: { order_id: "demo-42", reason: "delivery_delay" }, response: { success: false, error: "Confirm the current order status before refunding." }, status: 409 },
        ],
      },
    });
    if (!isRecord(result)) {
      throw new Error("Meta AI returned an invalid demo review.");
    }
    phase = "explanation validation";
    const explanation = parseRegressionFailureExplanation(
      { summary: result.summary, findings: result.findings },
      [DEMO_FAILED_CHECK],
    );
    phase = "regression draft validation";
    const testCases = parseGeneratedRegressionTestCases({ test_cases: result.test_cases });
    return NextResponse.json({
      explanation,
      testCases,
      model,
      aiUsage: { used: budget.used, limit: aiRequestLimit },
    });
  } catch (error) {
    console.error(
      `MockAgent demo: ${phase} failed`,
      error instanceof Error ? error.message : error,
    );
    return NextResponse.json(
      {
        error: getDemoFailureMessage(error, phase),
        aiUsage: { used: budget.used, limit: aiRequestLimit },
      },
      { status: 502 },
    );
  }
}
