import { NextResponse, type NextRequest } from "next/server";
import { enforceAIRequestBudget } from "@/lib/ai-usage";
import { aiMonthlyRequestLimit } from "@/lib/billing";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { generateToolDraft, getMetaConfig } from "@/lib/meta-ai";
import { parseGeneratedToolDraft } from "@/lib/tool-definition";

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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "Could not read the request body." }, { status: 400 });
  }
  if (rawBody.length > 16_000) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!isRecord(body)) {
    return NextResponse.json({ error: "Request body must be a JSON object." }, { status: 400 });
  }

  const prompt = body.prompt;
  if (typeof prompt !== "string" || prompt.trim().length < 5 || prompt.length > 2000) {
    return NextResponse.json({ error: "Prompt must be 5-2000 characters." }, { status: 400 });
  }

  const { configured, model } = getMetaConfig();
  if (!configured) {
    return NextResponse.json({ error: "Meta AI not configured" }, { status: 503 });
  }

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError) {
    console.error("MockAgent tool generation: failed to load active workspace", settingsError.message);
    return NextResponse.json({ error: "Could not load your active workspace." }, { status: 500 });
  }
  const workspaceId = body.workspaceId ?? settings?.current_workspace_id;
  if (typeof workspaceId !== "string" || workspaceId.length > 64) {
    return NextResponse.json({ error: "No active workspace is configured." }, { status: 409 });
  }

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError || !membership) {
    console.error("MockAgent tool generation: workspace membership could not be verified", membershipError?.message);
    return NextResponse.json({ error: "Your workspace could not be verified." }, { status: 403 });
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("plan,subscription_status")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError || !workspace) {
    console.error("MockAgent tool generation: failed to load workspace plan", workspaceError?.message);
    return NextResponse.json({ error: "Could not load your workspace plan." }, { status: 500 });
  }

  const aiRequestLimit = aiMonthlyRequestLimit(workspace.plan, workspace.subscription_status);
  const budget = await enforceAIRequestBudget(createAdminClient(), workspaceId);
  if (budget.response) return budget.response;

  try {
    const sanitized = prompt.trim().replace(/[\x00-\x1F\x7F]/g, " ");
    const generated = await generateToolDraft(sanitized);
    let draft;
    try {
      draft = parseGeneratedToolDraft(generated);
    } catch (error) {
      console.error(
        "MockAgent tool generation: Meta AI returned an invalid draft",
        error instanceof Error ? error.message : error
      );
      return NextResponse.json(
        {
          error: error instanceof Error
            ? `Meta AI returned an invalid tool draft: ${error.message}`
            : "Meta AI returned an invalid tool draft.",
          aiUsage: { used: budget.used, limit: aiRequestLimit },
        },
        { status: 502 }
      );
    }
    return NextResponse.json({
      draft,
      model,
      aiUsage: { used: budget.used, limit: aiRequestLimit },
    });
  } catch (error) {
    console.error("MockAgent tool generation: Meta AI request failed", error);
    return NextResponse.json(
      {
        error: "Meta AI could not generate a tool draft. Please try again.",
        aiUsage: { used: budget.used, limit: aiRequestLimit },
      },
      { status: 502 }
    );
  }
}
