"use client";
import { useEffect, useState } from "react";

interface HealthResponse {
  services?: {
    meta_ai?: string;
    redis?: string;
  };
}

export function WorkspaceAnalytics({ workspaceId }: { workspaceId: string }) {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then(async (response) => {
        if (!response.ok) throw new Error(`Health check failed (${response.status}).`);
        return await response.json() as HealthResponse;
      })
      .then((result) => { if (active) setHealth(result); })
      .catch((error: unknown) => {
        if (!active) return;
        setHealth({});
        setHealthError(error instanceof Error ? error.message : "Health check failed.");
      });
    return () => { active = false; };
  }, []);
  return (
    <div className="rounded-xl border p-4 bg-white">
      <h3 className="font-semibold text-sm">Advanced Insights</h3>
      <div className="grid grid-cols-3 gap-3 mt-3 text-center">
        <div className="bg-[#f3f7f3] rounded-lg p-3"><div className="text-xs text-muted-foreground">Meta AI</div><div className="text-xs font-mono">{health?.services?.meta_ai ?? "…"}</div></div>
        <div className="bg-[#f3f7f3] rounded-lg p-3"><div className="text-xs text-muted-foreground">Redis</div><div className="text-xs font-mono">{health?.services?.redis ?? "…"}</div></div>
        <div className="bg-[#f3f7f3] rounded-lg p-3"><div className="text-xs text-muted-foreground">Workspace</div><div className="text-xs font-mono">{workspaceId.slice(0,8)}…</div></div>
      </div>
      {healthError && <p role="status" className="text-xs text-amber-700">{healthError}</p>}
      <p className="text-[11px] text-muted-foreground mt-2">Powered by Muse Spark • Real-time health • Auto-retention</p>
    </div>
  );
}
