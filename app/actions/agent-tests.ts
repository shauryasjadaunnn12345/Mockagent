"use server";

import { revalidatePath } from "next/cache";
import { parseRegressionSuiteInput } from "@/lib/regression-suites";
import { createClient } from "@/lib/supabase/server";
import type { Json, Tables } from "@/types/database";

const REGRESSION_RUN_PAGE_SIZE = 100;
type RegressionRunHistoryRow = Pick<
  Tables<"agent_test_runs">,
  | "id"
  | "suite_id"
  | "run_id"
  | "status"
  | "test_case_index"
  | "test_case_name"
  | "checks"
  | "answer"
  | "model"
  | "trace"
  | "created_at"
>;

export async function loadMoreRegressionRuns(
  workspaceId: string,
  cursor: { created_at: string; id: string }
): Promise<
  | { success: true; runs: RegressionRunHistoryRow[]; hasMore: boolean }
  | { success: false; error: string }
> {
  if (
    typeof workspaceId !== "string" ||
    !cursor ||
    typeof cursor !== "object" ||
    typeof cursor.created_at !== "string" ||
    typeof cursor.id !== "string" ||
    !/^[0-9a-f-]{36}$/i.test(workspaceId) ||
    !/^[0-9a-f-]{36}$/i.test(cursor.id) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(cursor.created_at) ||
    !Number.isFinite(Date.parse(cursor.created_at))
  ) {
    return { success: false, error: "Regression run history cursor is invalid." };
  }

  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: "You must be signed in." };

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) {
    console.error("MockAgent: failed to verify regression history workspace", membershipError.message);
    return { success: false, error: "Could not verify workspace access." };
  }
  if (!membership) return { success: false, error: "Workspace not found." };

  const { data, error } = await supabase
    .from("agent_test_runs")
    .select("id,suite_id,run_id,status,test_case_index,test_case_name,checks,answer,model,trace,created_at")
    .eq("workspace_id", workspaceId)
    .or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(REGRESSION_RUN_PAGE_SIZE + 1);
  if (error) {
    console.error("MockAgent: failed to load older regression runs", error.message);
    return { success: false, error: "Could not load older regression runs." };
  }

  return {
    success: true,
    runs: (data ?? []).slice(0, REGRESSION_RUN_PAGE_SIZE),
    hasMore: (data?.length ?? 0) > REGRESSION_RUN_PAGE_SIZE,
  };
}

export async function createRegressionSuite(input: unknown) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "You must be signed in." };

  let suite;
  try {
    suite = parseRegressionSuiteInput(input);
  } catch (error) {
    return {
      success: false as const,
      error: error instanceof Error ? error.message : "Regression test is invalid.",
    };
  }

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError || !settings?.current_workspace_id) {
    return { success: false as const, error: "Could not resolve the active workspace." };
  }

  const { data: tools, error: toolsError } = await supabase
    .from("tools")
    .select("id,is_active,require_api_key")
    .eq("workspace_id", settings.current_workspace_id)
    .in("id", suite.toolIds);
  if (toolsError) {
    console.error("MockAgent: failed to validate regression tools", toolsError.message);
    return { success: false as const, error: "Could not validate the selected tools." };
  }
  if (tools?.length !== suite.toolIds.length) {
    return { success: false as const, error: "Selected tools must belong to the active workspace." };
  }
  const unavailable = tools.find((tool) => !tool.is_active || tool.require_api_key);
  if (unavailable) {
    return {
      success: false as const,
      error: "Regression tests currently require active tools without API-key protection.",
    };
  }

  const { error } = await supabase.from("agent_test_suites").insert({
    workspace_id: settings.current_workspace_id,
    created_by: user.id,
    name: suite.name,
    prompt: suite.prompt,
    test_cases: JSON.parse(JSON.stringify(suite.testCases)) as Json,
    tool_ids: suite.toolIds,
    expected_tool_ids: suite.expectedToolIds,
    required_answer_text: suite.requiredAnswerText,
    response_assertions: JSON.parse(JSON.stringify(suite.responseAssertions)) as Json,
  });
  if (error) {
    console.error("MockAgent: failed to save regression test", error.message);
    return {
      success: false as const,
      error: "Could not save regression test. Ensure the latest schema.sql has been run.",
    };
  }

  revalidatePath("/dashboard");
  return { success: true as const };
}

export async function deleteRegressionSuite(suiteId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "You must be signed in." };

  const { data: settings, error: settingsError } = await supabase
    .from("user_settings")
    .select("current_workspace_id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (settingsError || !settings?.current_workspace_id) {
    return { success: false as const, error: "Could not resolve the active workspace." };
  }

  const { data, error } = await supabase
    .from("agent_test_suites")
    .delete()
    .eq("id", suiteId)
    .eq("workspace_id", settings.current_workspace_id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("MockAgent: failed to delete regression test", error.message);
    return { success: false as const, error: "Could not delete regression test." };
  }
  if (!data) return { success: false as const, error: "Regression test not found." };

  revalidatePath("/dashboard");
  return { success: true as const };
}
