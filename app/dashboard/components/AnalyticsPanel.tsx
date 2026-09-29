"use client";

import { useState, useTransition } from "react";
import { updateLogRetention } from "@/app/actions/settings";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface DailyUsage {
  day: string | null;
  total_calls: number | null;
  successful_calls: number | null;
  schema_violations: number | null;
  average_latency_ms: number | null;
}

interface AnalyticsPanelProps {
  dailyUsage: DailyUsage[];
  workspaceId: string;
  retentionDays: number;
  maxRetentionDays: number;
  canManage: boolean;
}

export function AnalyticsPanel({ dailyUsage, workspaceId, retentionDays, maxRetentionDays, canManage }: AnalyticsPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const orderedUsage = [...dailyUsage].reverse();
  const totalCalls = dailyUsage.reduce((sum, day) => sum + (day.total_calls ?? 0), 0);
  const averageLatency = totalCalls === 0
    ? 0
    : Math.round(dailyUsage.reduce(
        (sum, day) => sum + (day.average_latency_ms ?? 0) * (day.total_calls ?? 0),
        0
      ) / totalCalls);
  const maxCalls = Math.max(1, ...orderedUsage.map((day) => day.total_calls ?? 0));

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle className="text-base font-semibold text-slate-900">Usage analytics</CardTitle>
        <label className="flex items-center gap-2 text-sm text-slate-600">
          Log retention
          <select
            aria-label="Log retention"
            className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-800"
            value={Math.min(retentionDays, maxRetentionDays)}
            disabled={isPending || !canManage}
            onChange={(event) => {
              const days = Number(event.currentTarget.value);
              setError(null);
              startTransition(async () => {
                const result = await updateLogRetention(workspaceId, days);
                if (!result.success) setError(result.error ?? "Could not update retention.");
              });
            }}
          >
            {[7, 30, 90].filter((days) => days <= maxRetentionDays).map((days) => (
              <option key={days} value={days}>{days} days</option>
            ))}
          </select>
        </label>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-slate-500">Calls, last 30 days</p>
            <p className="text-xl font-semibold text-slate-900">{totalCalls.toLocaleString()}</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Average latency</p>
            <p className="text-xl font-semibold text-slate-900">{averageLatency} ms</p>
          </div>
          <div>
            <p className="text-xs text-slate-500">Schema violations</p>
            <p className="text-xl font-semibold text-slate-900">
              {dailyUsage.reduce((sum, day) => sum + (day.schema_violations ?? 0), 0).toLocaleString()}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-2 sm:grid-cols-14" aria-label="Daily calls over the last 14 days">
          {orderedUsage.slice(-14).map((day) => {
            const calls = day.total_calls ?? 0;
            return (
              <div key={day.day} className="min-w-0 text-center" title={`${day.day}: ${calls} calls`}>
                <div className="flex h-16 items-end justify-center rounded-sm bg-slate-100">
                  <div
                    className="w-full rounded-sm bg-emerald-600"
                    style={{ height: `${Math.max(calls ? 8 : 0, (calls / maxCalls) * 100)}%` }}
                  />
                </div>
                <span className="mt-1 block text-[10px] text-slate-500">
                  {day.day ? new Date(`${day.day}T00:00:00`).getUTCDate() : ""}
                </span>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}