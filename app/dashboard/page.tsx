import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { StatsCards } from "@/app/dashboard/components/StatsCards";
import { ToolList } from "@/app/dashboard/components/ToolList";
import { CreateToolDialog } from "@/app/dashboard/components/CreateToolDialog";
import { LogsTable } from "@/app/dashboard/components/LogsTable";
import { FinalAnswerChecksTable } from "@/app/dashboard/components/FinalAnswerChecksTable";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/actions/auth";
import { ApiKeysPanel } from "@/app/dashboard/components/ApiKeysPanel";
import { AnalyticsPanel } from "@/app/dashboard/components/AnalyticsPanel";
import { WorkspacePanel, type WorkspaceMemberOption, type WorkspaceOption } from "@/app/dashboard/components/WorkspacePanel";
import { BillingPanel } from "@/app/dashboard/components/BillingPanel";
import { BasetenAssistant } from "@/app/dashboard/components/BasetenAssistant";
import { AgentPlayground } from "@/app/dashboard/components/AgentPlayground";
import { RegressionSuitesPanel } from "@/app/dashboard/components/RegressionSuitesPanel";
import { effectiveWorkspacePlan, PLAN_LIMITS } from "@/lib/billing";
import { parseRegressionTestCases } from "@/lib/regression-suites";

export const metadata: Metadata = {
  title: "Workspace dashboard",
  alternates: {
    canonical: "/dashboard",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [{ data: userSettings }, { data: memberships }] = await Promise.all([
    supabase
      .from("user_settings")
      .select("current_workspace_id,log_retention_days")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("workspace_members")
      .select("workspace_id,user_id,role")
      .eq("user_id", user.id),
  ]);

  const workspaceIds = (memberships ?? []).map((membership) => membership.workspace_id);
  const { data: workspaceRows } = workspaceIds.length
    ? await supabase.from("workspaces").select("id,name,log_retention_days,plan,subscription_status,current_period_end,dodo_customer_id,dodo_subscription_id").in("id", workspaceIds)
    : { data: [] };
  const activeWorkspaceId = workspaceIds.includes(userSettings?.current_workspace_id ?? "")
    ? userSettings?.current_workspace_id ?? ""
    : workspaceIds[0] ?? "";
  const activeWorkspaceRole = memberships?.find(
    (membership) => membership.workspace_id === activeWorkspaceId
  )?.role ?? "member";
  const activeWorkspace = workspaceRows?.find((workspace) => workspace.id === activeWorkspaceId);
  const effectivePlan = activeWorkspace
    ? effectiveWorkspacePlan(activeWorkspace.plan, activeWorkspace.subscription_status)
    : "free";
  let monthlyCallsUsed: number | null = 0;
  let monthlyAIRequestsUsed: number | null = 0;
  if (activeWorkspaceId) {
    const usageMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
    const admin = createAdminClient();
    const { data: currentWorkspaceUsage, error: currentWorkspaceUsageError } = await admin
      .from("workspace_usage")
      .select("calls_used")
      .eq("workspace_id", activeWorkspaceId)
      .eq("usage_month", usageMonth)
      .maybeSingle();
    if (currentWorkspaceUsageError) {
      console.error("MockAgent dashboard: failed to load workspace monthly usage", currentWorkspaceUsageError.message);
      monthlyCallsUsed = null;
    } else {
      monthlyCallsUsed = currentWorkspaceUsage?.calls_used ?? 0;
    }
    const { data: currentAIUsage, error: currentAIUsageError } = await admin
      .from("ai_workspace_usage")
      .select("requests_used")
      .eq("workspace_id", activeWorkspaceId)
      .eq("usage_month", usageMonth)
      .maybeSingle();
    if (currentAIUsageError) {
      console.error("MockAgent dashboard: failed to load monthly AI usage", currentAIUsageError.message);
      monthlyAIRequestsUsed = null;
    } else {
      monthlyAIRequestsUsed = currentAIUsage?.requests_used ?? 0;
    }
  }
  const workspaceOptions: WorkspaceOption[] = (workspaceRows ?? []).map((workspace) => ({
    ...workspace,
    role: memberships?.find((membership) => membership.workspace_id === workspace.id)?.role ?? "member",
  }));
  const [
    { data: tools },
    { data: logs },
    { data: finalAnswerSubmissions },
    { count: totalCalls },
    { count: schemaViolations },
    { data: apiKeys },
    { data: dailyUsage },
    { data: workspaceMemberRows },
    { data: regressionSuites, error: regressionSuitesError },
    { data: regressionRuns, error: regressionRunsError },
  ] = await Promise.all([
    supabase.from("tools").select("*").eq("workspace_id", activeWorkspaceId).order("created_at", { ascending: false }),
    supabase
      .from("logs")
      .select("*")
      .eq("workspace_id", activeWorkspaceId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("final_answer_submissions")
      .select("*")
      .eq("workspace_id", activeWorkspaceId)
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("logs").select("id", { count: "exact", head: true }).eq("workspace_id", activeWorkspaceId),
    supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", activeWorkspaceId)
      .eq("status", "SCHEMA_VIOLATION"),
    supabase
      .from("api_keys")
      .select("id,name,key_prefix,monthly_limit,created_at")
      .eq("workspace_id", activeWorkspaceId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("daily_usage")
      .select("day,total_calls,successful_calls,schema_violations,average_latency_ms")
      .eq("workspace_id", activeWorkspaceId)
      .order("day", { ascending: false })
      .limit(30),
      supabase.rpc("list_workspace_members", { target_workspace_id: activeWorkspaceId }),
    supabase
      .from("agent_test_suites")
      .select("id,name,prompt,test_cases,tool_ids,expected_tool_ids,required_answer_text,response_assertions,created_at")
      .eq("workspace_id", activeWorkspaceId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("agent_test_runs")
      .select("id,suite_id,run_id,status,test_case_index,test_case_name,checks,answer,model,trace,created_at")
      .eq("workspace_id", activeWorkspaceId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(101),
  ]);

      const workspaceMembers: WorkspaceMemberOption[] = workspaceMemberRows ?? [];
      const initialRegressionRuns = (regressionRuns ?? []).slice(0, 100);
      const hasMoreRegressionRuns = (regressionRuns?.length ?? 0) > 100;
      const regressionSuiteOptions = (regressionSuites ?? []).map((suite) => ({
        ...suite,
        test_cases: parseRegressionTestCases(suite.test_cases, suite.prompt),
      }));

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <div className="mx-auto max-w-6xl space-y-8 px-4 py-10">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">MockAgent</h1>
          <p className="text-sm text-slate-500">{user.email}</p>
        </div>
        <form action={signOut}>
          <Button variant="ghost" type="submit">
            Sign out
          </Button>
        </form>
      </header>

      <StatsCards
        tools={tools ?? []}
        totalCalls={totalCalls ?? 0}
        schemaViolations={schemaViolations ?? 0}
      />

      <WorkspacePanel
        workspaces={workspaceOptions}
        members={workspaceMembers}
        activeWorkspaceId={activeWorkspaceId}
        canInvite={activeWorkspaceRole === "owner" || activeWorkspaceRole === "admin"}
      />

      <BillingPanel
        workspaceId={activeWorkspaceId}
        plan={effectivePlan}
        status={activeWorkspace?.subscription_status ?? "free"}
        periodEnd={activeWorkspace?.current_period_end ?? null}
        hasCustomer={Boolean(activeWorkspace?.dodo_customer_id)}
        hasSubscription={Boolean(activeWorkspace?.dodo_subscription_id)}
        monthlyCallsUsed={monthlyCallsUsed}
        monthlyAIRequestsUsed={monthlyAIRequestsUsed}
        canManage={activeWorkspaceRole === "owner" || activeWorkspaceRole === "admin"}
      />

      <AnalyticsPanel
        dailyUsage={dailyUsage ?? []}
        workspaceId={activeWorkspaceId}
        retentionDays={activeWorkspace?.log_retention_days ?? 7}
        maxRetentionDays={PLAN_LIMITS[effectivePlan].retentionDays}
        canManage={activeWorkspaceRole === "owner" || activeWorkspaceRole === "admin"}
      />

      <AgentPlayground
        key={activeWorkspaceId}
        monthlyAIRequestsUsed={monthlyAIRequestsUsed}
        aiMonthlyRequestLimit={PLAN_LIMITS[effectivePlan].aiMonthlyRequests}
        tools={(tools ?? []).map((tool) => ({
          id: tool.id,
          name: tool.name,
          description: tool.description,
          is_active: tool.is_active,
          require_api_key: tool.require_api_key,
        }))}
      />

      <RegressionSuitesPanel
        key={`${activeWorkspaceId}-${initialRegressionRuns[0]?.id ?? "empty"}`}
        tools={(tools ?? []).map((tool) => ({
          id: tool.id,
          name: tool.name,
          is_active: tool.is_active,
          require_api_key: tool.require_api_key,
        }))}
        suites={regressionSuiteOptions}
        workspaceId={activeWorkspaceId}
        recentRuns={initialRegressionRuns}
        hasMoreRuns={hasMoreRegressionRuns}
        schemaReady={!regressionSuitesError && !regressionRunsError}
      />

      <BasetenAssistant
        key={activeWorkspaceId}
        monthlyAIRequestsUsed={monthlyAIRequestsUsed}
        aiMonthlyRequestLimit={PLAN_LIMITS[effectivePlan].aiMonthlyRequests}
      />

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Mock Tools</h2>
          <CreateToolDialog />
        </div>
        <ToolList tools={tools ?? []} appUrl={appUrl} />
      </section>

      <section>
        {(activeWorkspaceRole === "owner" || activeWorkspaceRole === "admin") && (
          <ApiKeysPanel apiKeys={apiKeys ?? []} maxMonthlyCalls={PLAN_LIMITS[effectivePlan].monthlyCalls} />
        )}
      </section>

      <section>
        <LogsTable initialLogs={logs ?? []} tools={tools ?? []} workspaceId={activeWorkspaceId} />
      </section>
      <section>
        <FinalAnswerChecksTable
          initialSubmissions={finalAnswerSubmissions ?? []}
          tools={tools ?? []}
          workspaceId={activeWorkspaceId}
        />
      </section>
    </div>
  );
}
