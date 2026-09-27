"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toggleToolActive, deleteTool } from "@/app/actions/tools";
import type { Tool } from "@/types/database";
import { Copy, Check, Trash2 } from "lucide-react";

interface ToolListProps {
  tools: Tool[];
  appUrl: string;
}

export function ToolList({ tools, appUrl }: ToolListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function copyUrl(toolId: string) {
    const url = `${appUrl}/api/v1/mock/${toolId}`;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(toolId);
      setTimeout(() => setCopiedId((id) => (id === toolId ? null : id)), 1500);
    });
  }

  if (tools.length === 0) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-slate-400">
          No mock tools yet — create one to get a gateway URL your agent can call.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {tools.map((tool) => (
        <Card key={tool.id}>
          <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                {tool.name}
                <Badge variant={tool.is_active ? "success" : "outline"}>
                  {tool.is_active ? "active" : "disabled"}
                </Badge>
              </CardTitle>
              {tool.description && (
                <p className="mt-1 text-sm text-slate-500">{tool.description}</p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(() => {
                    toggleToolActive(tool.id, !tool.is_active);
                  })
                }
              >
                {tool.is_active ? "Disable" : "Enable"}
              </Button>
              <Button
                variant="destructive"
                size="icon"
                disabled={isPending}
                onClick={() => {
                  if (confirm(`Delete "${tool.name}"? This also deletes its logs.`)) {
                    startTransition(() => {
                      deleteTool(tool.id);
                    });
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2 font-mono text-xs text-slate-600">
              <span className="truncate">{`${appUrl}/api/v1/mock/${tool.id}`}</span>
              <button
                onClick={() => copyUrl(tool.id)}
                className="ml-auto shrink-0 text-slate-500 hover:text-slate-900"
                aria-label="Copy gateway URL"
              >
                {copiedId === tool.id ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
