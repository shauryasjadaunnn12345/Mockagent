"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createToolset } from "@/app/actions/tools";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ToolsetSummary {
  id: string;
  name: string;
  slug: string;
  access_mode: string;
  created_at: string;
}

interface ToolOption {
  id: string;
  name: string;
  is_active: boolean;
}

interface ToolsetsPanelProps {
  toolsets: ToolsetSummary[];
  tools: ToolOption[];
  workspaceSlug: string;
}

export function ToolsetsPanel({ toolsets, tools, workspaceSlug }: ToolsetsPanelProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function create(formData: FormData) {
    setError(null);
    const name = String(formData.get("name") ?? "");
    const toolIds = formData.getAll("toolIds").map(String);
    startTransition(async () => {
      const response = await createToolset(name, toolIds);
      if (!response.success) {
        setError(response.error);
        return;
      }
      router.push(`/dashboard/toolsets/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(response.slug)}`);
      router.refresh();
    });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">MCP Toolsets</h2>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hosted MCP servers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {toolsets.length ? (
            <ul className="divide-y divide-slate-200 border-y border-slate-200">
              {toolsets.map((toolset) => (
                <li key={toolset.id} className="flex flex-wrap items-center gap-3 py-3">
                  <Link
                    className="font-medium text-slate-800 underline-offset-4 hover:underline"
                    href={`/dashboard/toolsets/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(toolset.slug)}`}
                  >
                    {toolset.name}
                  </Link>
                  <span className="font-mono text-xs text-slate-500">{toolset.slug}</span>
                  <Badge variant={toolset.access_mode === "open" ? "outline" : "success"}>
                    MCP · {toolset.access_mode === "open" ? "URL token" : "API key"}
                  </Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Create a toolset to expose selected workspace tools as a remote MCP server.</p>
          )}

          {tools.length === 0 ? (
            <p className="text-sm text-slate-500">Create an active mock tool before creating a toolset.</p>
          ) : (
            <form action={create} className="space-y-4 rounded-md border border-slate-200 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="toolset-name">New toolset name</Label>
                <Input id="toolset-name" name="name" maxLength={80} placeholder="Order tools" required />
              </div>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium text-slate-700">Include active tools</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {tools.filter((tool) => tool.is_active).map((tool) => (
                    <label key={tool.id} className="flex items-center gap-2 text-sm text-slate-700">
                      <input type="checkbox" name="toolIds" value={tool.id} />
                      {tool.name}
                    </label>
                  ))}
                </div>
              </fieldset>
              {error && <p className="text-sm text-red-700">{error}</p>}
              <Button type="submit" disabled={pending}>Create MCP toolset</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
