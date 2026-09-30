"use client";

import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";
import type { FinalAnswerAssertionResult } from "@/lib/final-answer-assertions";
import type { FinalAnswerSubmission, Tool } from "@/types/database";

interface FinalAnswerChecksTableProps {
  initialSubmissions: FinalAnswerSubmission[];
  tools: Tool[];
  workspaceId: string;
}

export function FinalAnswerChecksTable({
  initialSubmissions,
  tools,
  workspaceId,
}: FinalAnswerChecksTableProps) {
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const toolNameById = new Map(tools.map((tool) => [tool.id, tool.name]));

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("final-answer-submissions-realtime")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "final_answer_submissions",
          filter: `workspace_id=eq.${workspaceId}`,
        },
        (payload) => {
          setSubmissions((current) => [payload.new as FinalAnswerSubmission, ...current].slice(0, 100));
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
          Final Answer Checks
        </CardTitle>
      </CardHeader>
      <CardContent>
        {submissions.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">
            No final answers submitted yet.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Tool</TableHead>
                <TableHead>Run ID</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>Final Answer</TableHead>
                <TableHead>Assertions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {submissions.map((submission) => {
                const results = (Array.isArray(submission.assertion_results)
                  ? submission.assertion_results
                  : []) as unknown as FinalAnswerAssertionResult[];

                return (
                  <TableRow key={submission.id}>
                    <TableCell className="whitespace-nowrap text-slate-500">
                      {formatRelativeTime(submission.created_at)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {toolNameById.get(submission.tool_id) ?? "unknown"}
                    </TableCell>
                    <TableCell className="max-w-32 truncate font-mono text-xs text-slate-500" title={submission.run_id}>
                      {submission.run_id}
                    </TableCell>
                    <TableCell>
                      <Badge variant={submission.passed ? "success" : "destructive"}>
                        {submission.passed ? "Passed" : "Failed"}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-xs">
                      <details className="max-w-xs">
                        <summary className="cursor-pointer text-xs text-slate-600">View answer</summary>
                        <pre className="mt-1 max-h-48 max-w-xs overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs text-slate-700">
                          {submission.final_answer}
                        </pre>
                      </details>
                    </TableCell>
                    <TableCell>
                      <ul className="space-y-1 text-xs">
                        {results.map((result, index) => (
                          <li key={`${result.name}-${index}`} className="flex items-start gap-1.5">
                            {result.passed ? (
                              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" />
                            ) : (
                              <X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-700" />
                            )}
                            <span title={result.detail} className="text-slate-600">{result.name}</span>
                          </li>
                        ))}
                      </ul>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}