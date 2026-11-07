import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Shared regression run | MockAgent",
  robots: { index: false, follow: false },
};

interface SharedRunPageProps {
  params: Promise<{ runRecordId: string }>;
}

export default async function SharedRunPage({ params }: SharedRunPageProps) {
  const { runRecordId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runRecordId)) notFound();

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: run, error: runError } = await supabase
    .from("agent_test_runs")
    .select("id,workspace_id,run_id,status,test_case_name,checks,answer,model,trace,created_at")
    .eq("id", runRecordId)
    .maybeSingle();

  if (runError) {
    console.error("MockAgent: failed to load shared regression run", runError.message);
    throw new Error("Could not load this regression run.");
  }
  if (!run) notFound();

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("workspace_id", run.workspace_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (membershipError) {
    console.error("MockAgent: failed to verify shared run workspace membership", membershipError.message);
    throw new Error("Could not verify access to this regression run.");
  }
  if (!membership) notFound();

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10 sm:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-indigo-700">Workspace-only shared trace</p>
          <h1 className="mt-1 text-2xl font-bold text-slate-950">Regression run · {run.test_case_name}</h1>
          <p className="mt-2 text-sm text-slate-600">
            {run.status} · {run.model} · {new Date(run.created_at).toLocaleString()}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to dashboard</Link>
        </Button>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Final answer</h2>
        <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">{run.answer}</p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Checks</h2>
        <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-700">
          {JSON.stringify(run.checks, null, 2)}
        </pre>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="text-sm font-semibold text-slate-900">Tool trace</h2>
        {run.trace ? (
          <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words text-xs text-slate-700">
            {JSON.stringify(run.trace, null, 2)}
          </pre>
        ) : (
          <p className="mt-3 text-sm text-slate-500">No tool trace was saved for this run.</p>
        )}
      </section>

      <p className="text-xs text-slate-500">
        Run ID: <code>{run.run_id}</code>. This link is not public; viewers must be signed in and belong to the run&apos;s workspace.
      </p>
    </main>
  );
}
