"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { parseScenarios, resolveScenario, resolveScenarioResponse } from "@/lib/scenarios";
import { validateAgainstSchema } from "@/lib/validators";
import type { Json } from "@/types/database";
import { createHash, randomBytes } from "node:crypto";
import { effectiveWorkspacePlan, PLAN_LIMITS } from "@/lib/billing";
import { parseToolConfiguration, type ToolConfigurationInput } from "@/lib/tool-definition";
import { createOpenMcpToken } from "@/lib/mcp-auth";
import {
  prepareImportedToolConfigurations,
  previewToolImport,
  type ImportedTool,
  type ToolImportFormat,
} from "@/lib/tool-import";

export interface CreateToolInput {
  name: string;
  description: string;
  jsonSchema: string; // raw JSON text from the form, parsed here
  mockResponse: string; // raw JSON text from the form, parsed here
  scenarios: string;
  finalAnswerAssertions: string;
  semanticCriteria: string;
  requireApiKey: boolean;
}

export interface ActionResult {
  success: boolean;
  error?: string;
}

export async function previewToolImportAction(
  format: ToolImportFormat,
  source: string
): Promise<{ success: true; tools: ImportedTool[] } | { success: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in to import tools." };
  try {
    return { success: true, tools: previewToolImport(format, source) };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not preview this import.",
    };
  }
}

export async function createImportedTools(
  format: ToolImportFormat,
  source: string,
  selectedNames: string[]
): Promise<{ success: true; count: number } | { success: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  let importedTools: ImportedTool[];
  try {
    importedTools = prepareImportedToolConfigurations(format, source, selectedNames);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Could not import these tools.",
    };
  }
  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const workspaceId = settings?.current_workspace_id;
  if (settingsError || !workspaceId) {
    return { success: false, error: "Could not resolve the active workspace." };
  }
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return { success: false, error: "You are not a member of the active workspace." };

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("plan,subscription_status")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError || !workspace) {
    return { success: false, error: "Could not load the active workspace plan." };
  }
  const plan = effectiveWorkspacePlan(workspace.plan, workspace.subscription_status);
  const { count, error: countError } = await supabase
    .from("tools")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (countError || count === null) {
    return { success: false, error: "Could not check the workspace tool limit." };
  }
  const remaining = PLAN_LIMITS[plan].tools - count;
  if (importedTools.length > remaining) {
    return {
      success: false,
      error: `This import selects ${importedTools.length} tools, but the ${plan} plan has room for only ${Math.max(0, remaining)} more.`,
    };
  }

  const admin = createAdminClient();
  const { error: insertError } = await admin.from("tools").insert(
    importedTools.map((tool) => ({
      user_id: user.id,
      workspace_id: workspaceId,
      name: tool.name,
      description: tool.description || null,
      json_schema: tool.jsonSchema as Json,
      mock_response: tool.mockResponse as Json,
      scenarios: tool.scenarios as unknown as Json,
      final_answer_assertions: [],
      semantic_criteria: null,
      require_api_key: false,
    }))
  );
  if (insertError) {
    console.error("MockAgent: failed to create imported tools", insertError.message);
    return {
      success: false,
      error: insertError.message.includes("Workspace tool limit")
        ? "The workspace tool limit was reached before this import could finish."
        : "Could not create the imported tools. Check the names and try again.",
    };
  }

  revalidatePath("/dashboard");
  return { success: true, count: importedTools.length };
}

export async function createTool(input: CreateToolInput): Promise<ActionResult> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { success: false, error: "You must be signed in." };
  }

  let configuration;
  try {
    configuration = parseToolConfiguration(input);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "Invalid tool configuration." };
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
  const plan = workspace
    ? effectiveWorkspacePlan(workspace.plan, workspace.subscription_status)
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
    ...configuration,
    require_api_key: input.requireApiKey,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

export interface ToolRevisionSummary {
  id: string;
  snapshot: Json;
  created_at: string;
}

function getSnapshotConfiguration(snapshot: Json): ToolConfigurationInput | null {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  const value = snapshot as Record<string, Json | undefined>;
  if (
    typeof value.name !== "string" ||
    (value.description !== null && typeof value.description !== "string") ||
    !value.json_schema ||
    typeof value.json_schema !== "object" ||
    Array.isArray(value.json_schema) ||
    !value.mock_response ||
    typeof value.mock_response !== "object" ||
    Array.isArray(value.mock_response) ||
    !Array.isArray(value.scenarios) ||
    !Array.isArray(value.final_answer_assertions) ||
    (value.semantic_criteria !== null && typeof value.semantic_criteria !== "string")
  ) {
    return null;
  }
  return {
    name: value.name,
    description: value.description ?? "",
    jsonSchema: JSON.stringify(value.json_schema, null, 2),
    mockResponse: JSON.stringify(value.mock_response, null, 2),
    scenarios: JSON.stringify(value.scenarios, null, 2),
    finalAnswerAssertions: JSON.stringify(value.final_answer_assertions, null, 2),
    semanticCriteria: value.semantic_criteria ?? "",
  };
}

async function updateToolConfiguration(
  toolId: string,
  expectedUpdatedAt: string,
  input: ToolConfigurationInput
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };
  if (!toolId || !expectedUpdatedAt) {
    return { success: false, error: "Tool and version information are required." };
  }

  let configuration;
  try {
    configuration = parseToolConfiguration(input);
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Invalid tool configuration.",
    };
  }

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError || !settings?.current_workspace_id) {
    return { success: false, error: "Could not resolve the active workspace." };
  }

  const { data, error } = await supabase
    .from("tools")
    .update(configuration)
    .eq("id", toolId)
    .eq("workspace_id", settings.current_workspace_id)
    .eq("updated_at", expectedUpdatedAt)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("MockAgent: failed to update tool configuration", error.message);
    return { success: false, error: "Could not update the tool. Please try again." };
  }
  if (!data) {
    return {
      success: false,
      error: "This tool changed since you opened it. Refresh the dashboard and try again.",
    };
  }

  revalidatePath("/dashboard");
  return { success: true };
}

export async function updateTool(
  toolId: string,
  expectedUpdatedAt: string,
  input: ToolConfigurationInput
): Promise<ActionResult> {
  return updateToolConfiguration(toolId, expectedUpdatedAt, input);
}

export async function getToolRevisions(
  toolId: string
): Promise<{ success: true; revisions: ToolRevisionSummary[] } | { success: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError || !settings?.current_workspace_id) {
    return { success: false, error: "Could not resolve the active workspace." };
  }

  const { data, error } = await supabase
    .from("tool_revisions")
    .select("id,snapshot,created_at")
    .eq("tool_id", toolId)
    .eq("workspace_id", settings.current_workspace_id)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) {
    console.error("MockAgent: failed to load tool revisions", error.message);
    return {
      success: false,
      error: "Could not load revision history. Ensure the latest schema.sql has been run.",
    };
  }

  return { success: true, revisions: data ?? [] };
}

export async function restoreToolRevision(
  toolId: string,
  revisionId: string,
  expectedUpdatedAt: string
): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError || !settings?.current_workspace_id) {
    return { success: false, error: "Could not resolve the active workspace." };
  }

  const { data: revision, error } = await supabase
    .from("tool_revisions")
    .select("snapshot")
    .eq("id", revisionId)
    .eq("tool_id", toolId)
    .eq("workspace_id", settings.current_workspace_id)
    .maybeSingle();
  if (error || !revision) {
    return { success: false, error: "That revision was not found in the active workspace." };
  }

  const configurationInput = getSnapshotConfiguration(revision.snapshot);
  if (!configurationInput) {
    return { success: false, error: "That revision contains an invalid tool configuration." };
  }
  return updateToolConfiguration(toolId, expectedUpdatedAt, configurationInput);
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
  payload: Json,
  scenarioStep: number | null
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
  return {
    success: true,
    response: (scenario
      ? resolveScenarioResponse(scenario, scenarioStep ?? 1)
      : tool.mock_response) as Json,
  };
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
  const plan = workspace
    ? effectiveWorkspacePlan(workspace.plan, workspace.subscription_status)
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

export async function createToolset(
  name: string,
  toolIds: string[]
): Promise<{ success: true; slug: string } | { success: false; error: string }> {
  const normalizedName = name.trim();
  if (!normalizedName || normalizedName.length > 80) {
    return { success: false, error: "Toolset name must be between 1 and 80 characters." };
  }
  const uniqueToolIds = [...new Set(toolIds)];
  if (uniqueToolIds.length === 0 || uniqueToolIds.length > 250) {
    return { success: false, error: "Select between 1 and 250 tools." };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };
  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  const workspaceId = settings?.current_workspace_id;
  if (settingsError || !workspaceId) {
    return { success: false, error: "Could not resolve the active workspace." };
  }
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return { success: false, error: "You are not a member of the active workspace." };

  const { data: tools, error: toolsError } = await supabase
    .from("tools")
    .select("id,name")
    .eq("workspace_id", workspaceId)
    .in("id", uniqueToolIds);
  if (toolsError || tools?.length !== uniqueToolIds.length) {
    return { success: false, error: "Every selected tool must belong to the active workspace." };
  }
  if (new Set(tools.map((tool) => tool.name)).size !== tools.length) {
    return { success: false, error: "A toolset cannot contain tools with duplicate names." };
  }

  const slugBase = normalizedName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "toolset";
  const slug = `${slugBase}-${randomBytes(4).toString("hex")}`;
  const { data: toolset, error: toolsetError } = await supabase
    .from("toolsets")
    .insert({
      workspace_id: workspaceId,
      user_id: user.id,
      name: normalizedName,
      slug,
    })
    .select("id,slug")
    .single();
  if (toolsetError || !toolset) {
    console.error("MockAgent: failed to create toolset", toolsetError?.message);
    return { success: false, error: "Could not create the toolset. Please try again." };
  }

  const { error: membersError } = await supabase.from("toolset_tools").insert(
    uniqueToolIds.map((toolId, position) => ({
      toolset_id: toolset.id,
      tool_id: toolId,
      workspace_id: workspaceId,
      position,
    }))
  );
  if (membersError) {
    const { error: cleanupError } = await supabase.from("toolsets").delete().eq("id", toolset.id);
    if (cleanupError) {
      console.error("MockAgent: failed to clean up incomplete toolset", cleanupError.message);
    }
    return { success: false, error: "Could not add the selected tools to the toolset." };
  }
  revalidatePath("/dashboard");
  return { success: true, slug: toolset.slug };
}

export async function setToolsetAuthMode(
  toolsetId: string,
  accessMode: "api_key" | "open"
): Promise<{ success: true; token?: string } | { success: false; error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };
  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError || !settings?.current_workspace_id) {
    return { success: false, error: "Could not resolve the active workspace." };
  }

  const openToken = accessMode === "open" ? createOpenMcpToken() : null;
  const { data, error } = await supabase
    .from("toolsets")
    .update({
      access_mode: accessMode,
      open_token_hash: openToken?.hash ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", toolsetId)
    .eq("workspace_id", settings.current_workspace_id)
    .select("id")
    .maybeSingle();
  if (error || !data) {
    console.error("MockAgent: failed to update toolset authentication", error?.message);
    return { success: false, error: "Could not update toolset authentication." };
  }
  revalidatePath("/dashboard");
  return { success: true, ...(openToken ? { token: openToken.token } : {}) };
}

export async function deleteToolset(toolsetId: string): Promise<ActionResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "You must be signed in." };
  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError || !settings?.current_workspace_id) {
    return { success: false, error: "Could not resolve the active workspace." };
  }
  const { error } = await supabase
    .from("toolsets")
    .delete()
    .eq("id", toolsetId)
    .eq("workspace_id", settings.current_workspace_id);
  if (error) {
    console.error("MockAgent: failed to delete toolset", error.message);
    return { success: false, error: "Could not delete the toolset." };
  }
  revalidatePath("/dashboard");
  return { success: true };
}
