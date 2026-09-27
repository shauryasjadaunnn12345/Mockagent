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

interface LogsTableProps {
  initialLogs: LogEntry[];
  tools: Tool[];
  userId: string;
}

export function LogsTable({ initialLogs, tools, userId }: LogsTableProps) {
  const [logs, setLogs] = useState<LogEntry[]>(initialLogs);
  const toolNameById = new Map(tools.map((t) => [t.id, t.name]));

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
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          setLogs((current) => [payload.new as LogEntry, ...current].slice(0, 100));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

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
                <TableHead>Status</TableHead>
                <TableHead>Latency</TableHead>
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
                  <TableCell>
                    <Badge variant={log.status === "SUCCESS" ? "success" : "destructive"}>
                      {log.status === "SUCCESS" ? "Success" : "Schema Error"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-slate-500">{log.latency_ms} ms</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
