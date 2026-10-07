import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
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
import { PLAN_LIMITS, type WorkspacePlan } from "@/lib/billing";

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
    ? await supabase.from("workspaces").select("id,name,log_retention_days,plan,subscription_status,current_period_end,dodo_customer_id").in("id", workspaceIds)
    : { data: [] };
  const activeWorkspaceId = workspaceIds.includes(userSettings?.current_workspace_id ?? "")
    ? userSettings?.current_workspace_id ?? ""
    : workspaceIds[0] ?? "";
  const activeWorkspaceRole = memberships?.find(
    (membership) => membership.workspace_id === activeWorkspaceId
  )?.role ?? "member";
  const activeWorkspace = workspaceRows?.find((workspace) => workspace.id === activeWorkspaceId);
  const effectivePlan: WorkspacePlan = activeWorkspace && ["active", "past_due"].includes(activeWorkspace.subscription_status)
    ? activeWorkspace.plan as WorkspacePlan
    : "free";
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
  ]);

      const workspaceMembers: WorkspaceMemberOption[] = workspaceMemberRows ?? [];

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
        canManage={activeWorkspaceRole === "owner" || activeWorkspaceRole === "admin"}
      />

      <AnalyticsPanel
        dailyUsage={dailyUsage ?? []}
        workspaceId={activeWorkspaceId}
        retentionDays={activeWorkspace?.log_retention_days ?? 7}
        maxRetentionDays={PLAN_LIMITS[effectivePlan].retentionDays}
        canManage={activeWorkspaceRole === "owner" || activeWorkspaceRole === "admin"}
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
