"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { validateSchemaDefinition } from "@/lib/validators";
import { parseScenarios } from "@/lib/scenarios";
import { resolveScenario } from "@/lib/scenarios";
import { validateAgainstSchema } from "@/lib/validators";
import type { Json } from "@/types/database";
import { createHash, randomBytes } from "node:crypto";
import { PLAN_LIMITS, type WorkspacePlan } from "@/lib/billing";

export interface CreateToolInput {
  name: string;
  description: string;
  jsonSchema: string; // raw JSON text from the form, parsed here
  mockResponse: string; // raw JSON text from the form, parsed here
  scenarios: string;
  requireApiKey: boolean;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

function safeJsonParse(raw: string, fieldLabel: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`${fieldLabel} must be a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    throw new Error(
      err instanceof Error && err.message.includes("must be a JSON object")
        ? err.message
        : `${fieldLabel} is not valid JSON.`
    );
  }
}

export async function createTool(input: CreateToolInput): Promise<ActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be signed in." };
  }

  if (!input.name.trim()) {
    return { success: false, error: "Tool name is required." };
  }

  let jsonSchema: Record<string, unknown>;
  let mockResponse: Record<string, unknown>;
  let scenarios;
  try {
    jsonSchema = safeJsonParse(input.jsonSchema, "Expected JSON Schema");
    mockResponse = safeJsonParse(input.mockResponse, "Mock response body");
    scenarios = parseScenarios(JSON.parse(input.scenarios));
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Invalid JSON." };
  }

  const schemaError = validateSchemaDefinition(jsonSchema);
  if (schemaError) {
    return {
      success: false,
      error: `Expected JSON Schema is invalid: ${schemaError}`,
    };
  }

  for (const [index, scenario] of scenarios.entries()) {
    const scenarioSchemaError = validateSchemaDefinition(scenario.match);
    if (scenarioSchemaError) {
      return {
        success: false,
        error: `Scenario ${index + 1} has an invalid match schema: ${scenarioSchemaError}`,
      };
    }
  }

  const { data: userSettings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError || !userSettings?.current_workspace_id) {
    return { success: false, error: "Could not resolve the active workspace." };
  }
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", userSettings.current_workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return { success: false, error: "You are not a member of the active workspace." };

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("plan,subscription_status")
    .eq("id", userSettings.current_workspace_id)
    .maybeSingle();
  const plan: WorkspacePlan = workspace && ["active", "past_due"].includes(workspace.subscription_status)
    ? workspace.plan as WorkspacePlan
    : "free";
  const { count: toolCount } = await supabase
    .from("tools")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", userSettings.current_workspace_id);
  if ((toolCount ?? 0) >= PLAN_LIMITS[plan].tools) {
    return { success: false, error: `The ${plan} plan allows ${PLAN_LIMITS[plan].tools} tools. Upgrade to add more.` };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("tools").insert({
    user_id: user.id,
    workspace_id: userSettings.current_workspace_id,
    name: input.name.trim(),
    description: input.description.trim() || null,
    json_schema: jsonSchema as Json,
    mock_response: mockResponse as Json,
    scenarios: scenarios as unknown as Json,
    require_api_key: input.requireApiKey,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

export async function toggleToolActive(toolId: string, isActive: boolean): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").update({ is_active: isActive }).eq("id", toolId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}

export async function setToolRequireApiKey(
  toolId: string,
  requireApiKey: boolean
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  const { error } = await supabase
    .from("tools")
    .update({ require_api_key: requireApiKey })
    .eq("id", toolId)
    .eq("user_id", user.id);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteTool(toolId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from("tools").delete().eq("id", toolId);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}

export async function replayToolCall(
  toolId: string,
  payload: Json
): Promise<{ success: true; response: Json } | { success: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to replay a request." };

  const { data: tool, error } = await supabase
    .from("tools")
    .select("json_schema,mock_response,scenarios,is_active")
    .eq("id", toolId)
    .maybeSingle();
  if (error || !tool) return { success: false, error: "Tool not found in your workspace." };
  if (!tool.is_active) return { success: false, error: "This tool is disabled." };

  const validation = validateAgainstSchema(tool.json_schema as Record<string, unknown>, payload);
  if (!validation.valid) return { success: false, error: "The original payload no longer matches the tool schema." };

  const scenario = resolveScenario(parseScenarios(tool.scenarios), payload);
  return { success: true, response: (scenario?.response ?? tool.mock_response) as Json };
}

export interface ApiKeySummary {
  id: string;
  name: string;
  key_prefix: string;
  monthly_limit: number;
  created_at: string;
}

export async function createApiKey(
  name: string,
  monthlyLimit: number
): Promise<{ success: true; key: string } | { success: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  const normalizedName = name.trim();
  if (!normalizedName) return { success: false, error: "Key name is required." };
  if (!Number.isInteger(monthlyLimit) || monthlyLimit < 1 || monthlyLimit > 1000000) {
    return { success: false, error: "Monthly limit must be between 1 and 1,000,000 calls." };
  }

  const { data: userSettings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError || !userSettings?.current_workspace_id) {
    return { success: false, error: "Could not resolve the active workspace." };
  }
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", userSettings.current_workspace_id)
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (!membership) return { success: false, error: "Only workspace owners and admins can create API keys." };

  const { data: workspace } = await supabase
    .from("workspaces")
    .select("plan,subscription_status")
    .eq("id", userSettings.current_workspace_id)
    .maybeSingle();
  const plan: WorkspacePlan = workspace && ["active", "past_due"].includes(workspace.subscription_status)
    ? workspace.plan as WorkspacePlan
    : "free";
  const { count: activeKeys } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", userSettings.current_workspace_id)
    .is("revoked_at", null);
  if ((activeKeys ?? 0) >= PLAN_LIMITS[plan].apiKeys) {
    return { success: false, error: `The ${plan} plan allows ${PLAN_LIMITS[plan].apiKeys} active API keys.` };
  }
  if (monthlyLimit > PLAN_LIMITS[plan].monthlyCalls) {
    return { success: false, error: `The ${plan} plan allows at most ${PLAN_LIMITS[plan].monthlyCalls.toLocaleString()} calls per API key.` };
  }

  const key = `ma_live_${randomBytes(32).toString("hex")}`;
  const admin = createAdminClient();
  const { error } = await admin.from("api_keys").insert({
    user_id: user.id,
    workspace_id: userSettings.current_workspace_id,
    name: normalizedName,
    key_prefix: key.slice(0, 24),
    key_hash: createHash("sha256").update(key).digest("hex"),
    monthly_limit: monthlyLimit,
  });

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true, key };
}

export async function revokeApiKey(keyId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  const { error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .is("revoked_at", null);

  if (error) return { success: false, error: error.message };
  revalidatePath("/dashboard");
  return { success: true };
}
