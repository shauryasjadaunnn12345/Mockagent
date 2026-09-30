"use client";

import { useEffect, useState } from "react";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";
import type { LogEntry, Tool } from "@/types/database";
import { Button } from "@/components/ui/button";
import { Check, Play, X } from "lucide-react";
import { replayToolCall } from "@/app/actions/tools";

type ReplayResult = { matches: boolean; error?: string };

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

interface LogsTableProps {
  initialLogs: LogEntry[];
  tools: Tool[];
  workspaceId: string;
}

export function LogsTable({ initialLogs, tools, workspaceId }: LogsTableProps) {
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [replayResults, setReplayResults] = useState<Record<string, ReplayResult>>({});
  const toolNameById = new Map(tools.map((t) => [t.id, t.name]));

  async function replay(log: LogEntry) {
    setReplayingId(log.id);
    setReplayResults((current) => {
      const next = { ...current };
      delete next[log.id];
      return next;
    });
    try {
      const replayResult = await replayToolCall(log.tool_id, log.payload, log.scenario_step);
      if (!replayResult.success) throw new Error(replayResult.error);
      setReplayResults((current) => ({
        ...current,
        [log.id]: { matches: stableJson(replayResult.response) === stableJson(log.response_body) },
      }));
    } catch (error) {
      setReplayResults((current) => ({
        ...current,
        [log.id]: {
          matches: false,
          error: error instanceof Error ? error.message : "Replay failed",
        },
      }));
    } finally {
      setReplayingId(null);
    }
  }

  useEffect(() => {
    const supabase = createClient();

    // Live-update the log table as new gateway calls land, without a page reload.
    const channel = supabase
      .channel("logs-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "logs",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          setLogs((current) => [payload.new as LogEntry, ...current].slice(0, 100));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [workspaceId]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-900">
          Execution Logs
        </CardTitle>
      </CardHeader>
      <CardContent>
        {logs.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No calls logged yet. POST to a tool&apos;s gateway URL to see logs appear here in
            real time.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Tool</TableHead>
                <TableHead>Input Arguments</TableHead>
                <TableHead>Response</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Scenario</TableHead>
                <TableHead>Run ID</TableHead>
                <TableHead>Latency</TableHead>
                <TableHead>Regression</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-slate-500">
                    {formatRelativeTime(log.created_at)}
                  </TableCell>
                  <TableCell className="font-medium">
                    {toolNameById.get(log.tool_id) ?? "unknown"}
                  </TableCell>
                  <TableCell className="max-w-xs">
                    <code className="block max-w-xs truncate font-mono text-xs text-slate-600">
                      {JSON.stringify(log.payload)}
                    </code>
                  </TableCell>
                  <TableCell className="max-w-xs">
                    {log.response_body !== null ? (
                      <details className="max-w-xs">
                        <summary className="cursor-pointer text-xs text-slate-600">View JSON</summary>
                        <pre className="mt-1 max-h-48 max-w-xs overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-xs text-slate-700">
                          {JSON.stringify(log.response_body, null, 2)}
                        </pre>
                      </details>
                    ) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={log.status === "SUCCESS" ? "success" : "destructive"}>
                      {log.status === "SUCCESS" ? "Success" : "Schema Error"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-500">
                    {log.scenario_name ?? "Default"}{log.scenario_step ? ` · step ${log.scenario_step}` : ""}
                  </TableCell>
                  <TableCell className="max-w-32 truncate font-mono text-xs text-slate-500" title={log.run_id ?? undefined}>
                    {log.run_id ?? "—"}
                  </TableCell>
                  <TableCell className="text-slate-500">{log.latency_ms} ms</TableCell>
                  <TableCell>
                    {log.status === "SUCCESS" && log.response_body !== null ? (
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={replayingId !== null}
                          onClick={() => replay(log)}
                          aria-label={`Replay ${toolNameById.get(log.tool_id) ?? "tool"} call`}
                        >
                          <Play className="h-3.5 w-3.5" />
                          {replayingId === log.id ? "Replaying" : "Replay"}
                        </Button>
                        {replayResults[log.id] && (
                          <span
                            className={`inline-flex items-center gap-1 text-xs ${replayResults[log.id].matches ? "text-emerald-700" : "text-red-700"}`}
                            title={replayResults[log.id].error}
                          >
                            {replayResults[log.id].matches ? (
                              <><Check className="h-3.5 w-3.5" /> Match</>
                            ) : (
                              <><X className="h-3.5 w-3.5" /> Changed</>
                            )}
                          </span>
                        )}
                      </div>
                    ) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
