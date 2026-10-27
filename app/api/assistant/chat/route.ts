import { NextResponse, type NextRequest } from "next/server";
import { enforceAIRequestBudget } from "@/lib/ai-usage";
import { aiMonthlyRequestLimit } from "@/lib/billing";
import { createAdminClient, createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function isChatMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    message.content.trim().length > 0 &&
    message.content.length <= 4000
  );
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Sign in to use the assistant." }, { status: 401 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_000) {
    return NextResponse.json({ error: "The conversation is too large." }, { status: 413 });
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

  const messages = (body as Record<string, unknown>).messages;
  if (
    !Array.isArray(messages) ||
    messages.length === 0 ||
    messages.length > 20 ||
    !messages.every(isChatMessage) ||
    messages.reduce((total, message) => total + message.content.length, 0) > 12_000 ||
    messages[messages.length - 1].role !== "user"
  ) {
    return NextResponse.json({ error: "Conversation messages are invalid or too large." }, { status: 400 });
  }

  const apiKey = process.env.SEMANTIC_JUDGE_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Baseten is not configured. Set SEMANTIC_JUDGE_API_KEY on the server." },
      { status: 503 }
    );
  }

  const baseUrl = (
    process.env.SEMANTIC_JUDGE_BASE_URL?.trim() || "https://inference.baseten.co/v1"
  ).replace(/\/+$/, "");
  const model = process.env.SEMANTIC_JUDGE_MODEL?.trim() || "meta-models/muse-spark-open-1026";

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError) {
    console.error("MockAgent assistant: failed to load active workspace", settingsError.message);
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
    console.error("MockAgent assistant: active workspace membership could not be verified", membershipError?.message);
    return NextResponse.json({ error: "Your active workspace could not be verified." }, { status: 403 });
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("plan,subscription_status")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError || !workspace) {
    console.error("MockAgent assistant: failed to load workspace plan", workspaceError?.message);
    return NextResponse.json({ error: "Could not load your workspace plan." }, { status: 500 });
  }
  const aiRequestLimit = aiMonthlyRequestLimit(workspace.plan, workspace.subscription_status);
  const budget = await enforceAIRequestBudget(createAdminClient(), workspaceId);
  if (budget.response) return budget.response;

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [
          {
            role: "system",
            content:
              "You are the MockAgent AI assistant. Help developers build and test AI agents using mock tools, JSON schemas, scenarios, run IDs, and final-answer checks. Give practical, concise guidance. You do not have access to the user's workspace, files, tools, or logs unless they include information in their message. Never claim to have performed actions in their project.",
          },
          ...messages,
        ],
      }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return NextResponse.json(
        { error: "Baseten took too long to respond. Please try again.", aiUsage: { used: budget.used, limit: aiRequestLimit } },
        { status: 504 }
      );
    }
    console.error("MockAgent assistant: Baseten request failed", error);
    return NextResponse.json(
      { error: "Could not connect to Baseten. Please try again.", aiUsage: { used: budget.used, limit: aiRequestLimit } },
      { status: 502 }
    );
  }

  if (!upstreamResponse.ok) {
    console.error("MockAgent assistant: Baseten returned HTTP", upstreamResponse.status);
    return NextResponse.json(
      {
        error: "Baseten could not complete the request. Check the server configuration and try again.",
        aiUsage: { used: budget.used, limit: aiRequestLimit },
      },
      { status: 502 }
    );
  }

  let upstreamBody: unknown;
  try {
    upstreamBody = await upstreamResponse.json();
  } catch (error) {
    console.error("MockAgent assistant: Baseten returned invalid JSON", error);
    return NextResponse.json(
      { error: "Baseten returned an invalid response.", aiUsage: { used: budget.used, limit: aiRequestLimit } },
      { status: 502 }
    );
  }

  if (!upstreamBody || typeof upstreamBody !== "object") {
    return NextResponse.json(
      { error: "Baseten returned an invalid response.", aiUsage: { used: budget.used, limit: aiRequestLimit } },
      { status: 502 }
    );
  }
  const choices = (upstreamBody as Record<string, unknown>).choices;
  const firstChoice =
    Array.isArray(choices) && choices[0] && typeof choices[0] === "object"
      ? (choices[0] as Record<string, unknown>)
      : null;
  const responseMessage =
    firstChoice?.message && typeof firstChoice.message === "object"
      ? (firstChoice.message as Record<string, unknown>)
      : null;
  const content = responseMessage?.content;

  if (typeof content !== "string" || !content.trim()) {
    return NextResponse.json(
      { error: "Baseten returned an empty response.", aiUsage: { used: budget.used, limit: aiRequestLimit } },
      { status: 502 }
    );
  }

  return NextResponse.json({
    message: content,
    aiUsage: { used: budget.used, limit: aiRequestLimit },
  });
}
