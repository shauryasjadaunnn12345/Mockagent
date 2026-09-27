import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { StatsCards } from "@/app/dashboard/components/StatsCards";
import { ToolList } from "@/app/dashboard/components/ToolList";
import { CreateToolDialog } from "@/app/dashboard/components/CreateToolDialog";
import { LogsTable } from "@/app/dashboard/components/LogsTable";
import { Button } from "@/components/ui/button";
import { signOut } from "@/app/actions/auth";

export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [
    { data: tools },
    { data: logs },
    { count: totalCalls },
    { count: schemaViolations },
  ] = await Promise.all([
    supabase.from("tools").select("*").order("created_at", { ascending: false }),
    supabase
      .from("logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase.from("logs").select("id", { count: "exact", head: true }),
    supabase
      .from("logs")
      .select("id", { count: "exact", head: true })
      .eq("status", "SCHEMA_VIOLATION"),
  ]);

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

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Mock Tools</h2>
          <CreateToolDialog />
        </div>
        <ToolList tools={tools ?? []} appUrl={appUrl} />
      </section>

      <section>
        <LogsTable initialLogs={logs ?? []} tools={tools ?? []} userId={user.id} />
      </section>
    </div>
  );
}
