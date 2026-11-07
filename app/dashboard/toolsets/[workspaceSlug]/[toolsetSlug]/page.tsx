import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { McpConnectPanel } from "@/app/dashboard/components/McpConnectPanel";
import { Badge } from "@/components/ui/badge";

interface PageProps {
  params: Promise<{ workspaceSlug: string; toolsetSlug: string }>;
}

export default async function ToolsetPage({ params }: PageProps) {
  const { workspaceSlug, toolsetSlug } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: workspace, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id,name,slug")
    .eq("slug", workspaceSlug)
    .maybeSingle();
  if (workspaceError) {
    console.error("MockAgent: failed to load toolset workspace", workspaceError.message);
    notFound();
  }
  if (!workspace) notFound();

  const { data: toolset, error: toolsetError } = await supabase
    .from("toolsets")
    .select("id,name,slug,access_mode,workspace_id")
    .eq("workspace_id", workspace.id)
    .eq("slug", toolsetSlug)
    .maybeSingle();
  if (toolsetError) {
    console.error("MockAgent: failed to load toolset", toolsetError.message);
    notFound();
  }
  if (!toolset) notFound();

  const { data: links, error: linksError } = await supabase
    .from("toolset_tools")
    .select("tool_id,position")
    .eq("workspace_id", workspace.id)
    .eq("toolset_id", toolset.id)
    .order("position", { ascending: true });
  if (linksError) {
    console.error("MockAgent: failed to load toolset members", linksError.message);
    notFound();
  }
  const ids = (links ?? []).map((link) => link.tool_id);
  const { data: loadedTools, error: toolsError } = ids.length
    ? await supabase
        .from("tools")
        .select("id,name,description,is_active,require_api_key")
        .eq("workspace_id", workspace.id)
        .in("id", ids)
    : { data: [], error: null };
  if (toolsError) {
    console.error("MockAgent: failed to load toolset tools", toolsError.message);
    notFound();
  }
  const toolsById = new Map((loadedTools ?? []).map((tool) => [tool.id, tool]));
  const tools = ids.flatMap((id) => {
    const tool = toolsById.get(id);
    return tool ? [tool] : [];
  });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-10">
      <Link href="/dashboard" className="text-sm text-slate-600 underline-offset-4 hover:underline">
        ← Dashboard
      </Link>
      <header className="space-y-2">
        <p className="text-sm text-slate-500">{workspace.name} · {workspace.slug}</p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-900">{toolset.name}</h1>
          <Badge variant="outline">MCP</Badge>
        </div>
        <p className="font-mono text-sm text-slate-500">{toolset.slug}</p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Included tools ({tools.length})</h2>
        <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {tools.map((tool) => (
            <li key={tool.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="font-medium text-slate-800">{tool.name}</span>
              <Badge variant={tool.is_active ? "success" : "outline"}>
                {tool.is_active ? "active" : "disabled"}
              </Badge>
              {tool.require_api_key && <Badge variant="outline">API key required</Badge>}
              {tool.description && <span className="basis-full text-sm text-slate-500">{tool.description}</span>}
            </li>
          ))}
        </ul>
      </section>

      <McpConnectPanel
        toolsetId={toolset.id}
        toolsetName={toolset.name}
        workspaceSlug={workspace.slug}
        toolsetSlug={toolset.slug}
        accessMode={toolset.access_mode as "api_key" | "open"}
        appUrl={appUrl}
      />
    </main>
  );
}
