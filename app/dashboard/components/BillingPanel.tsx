"use client";

import { useState, useTransition } from "react";
import { createBillingPortalSession, createCheckoutSession } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PLAN_LIMITS, type WorkspacePlan } from "@/lib/billing";
import { CreditCard } from "lucide-react";

interface BillingPanelProps {
  workspaceId: string;
  plan: WorkspacePlan;
  status: string;
  periodEnd: string | null;
  hasCustomer: boolean;
  hasSubscription: boolean;
  monthlyCallsUsed: number | null;
  monthlyAIRequestsUsed: number | null;
  canManage: boolean;
}

const plans = [
  { id: "solo" as const, name: "Solo", price: "$19/mo", detail: "20,000 calls · 1,000 AI requests · 25 tools · 30-day logs" },
  { id: "team" as const, name: "Team", price: "$79/mo", detail: "100,000 calls · 5,000 AI requests · 250 tools · 10 seats · 90-day logs" },
];

export function BillingPanel({
  workspaceId,
  plan,
  status,
  periodEnd,
  hasCustomer,
  hasSubscription,
  monthlyCallsUsed,
  monthlyAIRequestsUsed,
  canManage,
}: BillingPanelProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function checkout(targetPlan: "solo" | "team") {
    setError(null);
    startTransition(async () => {
      const result = await createCheckoutSession(workspaceId, targetPlan);
      if (result.success) window.location.assign(result.url);
      else setError(result.error);
    });
  }

  function openPortal() {
    setError(null);
    startTransition(async () => {
      const result = await createBillingPortalSession(workspaceId);
      if (result.success) window.location.assign(result.url);
      else setError(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <CreditCard className="h-4 w-4" /> Plan and billing
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-slate-700">
            Current plan: <span className="font-semibold capitalize">{plan}</span>
            <span className="ml-2 text-slate-500">({status})</span>
          </p>
          {periodEnd && <p className="text-xs text-slate-500">Period ends {new Date(periodEnd).toLocaleDateString()}</p>}
        </div>
        {status === "past_due" && (
          <p role="status" className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            Payment is past due. Your current plan remains available during the payment grace period; update billing details to avoid losing paid limits.
          </p>
        )}
        {hasSubscription && plan === "free" && (
          <p role="status" className="rounded-md bg-slate-50 p-3 text-sm text-slate-700">
            This subscription is {status}. Manage or resolve it in the billing portal before starting another subscription.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {hasCustomer && <Button type="button" variant="outline" disabled={isPending} onClick={openPortal}>Manage subscription</Button>}
            {plan === "free" && !hasSubscription && plans.map((candidate) => (
              <Button key={candidate.id} type="button" disabled={isPending} onClick={() => checkout(candidate.id)}>
                Upgrade to {candidate.name} · {candidate.price}
              </Button>
            ))}
          </div>
        )}
        <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2">
          {plans.map((candidate) => (
            <div key={candidate.id} className="text-sm">
              <p className="font-medium text-slate-800">{candidate.name} <span className="font-normal text-slate-500">{candidate.price}</span></p>
              <p className="text-xs text-slate-500">{candidate.detail}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-200 pt-3">
          <p className="text-xs font-medium text-slate-700">Current plan limits</p>
          <p className="mt-1 text-xs text-slate-500">
            {PLAN_LIMITS[plan].monthlyCalls.toLocaleString()} calls/month · {PLAN_LIMITS[plan].tools} tools ·{" "}
            {PLAN_LIMITS[plan].aiMonthlyRequests.toLocaleString()} AI requests/month · {PLAN_LIMITS[plan].seats} seats · {PLAN_LIMITS[plan].apiKeys} API keys ·{" "}
            {PLAN_LIMITS[plan].retentionDays} days log retention
          </p>
          <div className="mt-3">
            <div className="flex justify-between gap-2 text-xs">
              <span className="text-slate-600">Workspace calls this month</span>
              <span className="font-medium text-slate-700">
                {monthlyCallsUsed === null
                  ? "Usage unavailable"
                  : `${monthlyCallsUsed.toLocaleString()} / ${PLAN_LIMITS[plan].monthlyCalls.toLocaleString()}`}
              </span>
            </div>
            {monthlyCallsUsed !== null && (
              <>
                <div
                  className="mt-1.5 h-2 overflow-hidden rounded bg-slate-100"
                  role="meter"
                  aria-label="Monthly workspace call usage"
                  aria-valuemin={0}
                  aria-valuemax={PLAN_LIMITS[plan].monthlyCalls}
                  aria-valuenow={Math.min(monthlyCallsUsed, PLAN_LIMITS[plan].monthlyCalls)}
                >
                  <div
                    className={`h-full ${monthlyCallsUsed >= PLAN_LIMITS[plan].monthlyCalls ? "bg-red-500" : "bg-blue-500"}`}
                    style={{ width: `${Math.min(100, (monthlyCallsUsed / PLAN_LIMITS[plan].monthlyCalls) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {monthlyCallsUsed >= PLAN_LIMITS[plan].monthlyCalls
                    ? "Monthly quota reached; gateway calls are blocked until the next UTC month or a plan change."
                    : `${(PLAN_LIMITS[plan].monthlyCalls - monthlyCallsUsed).toLocaleString()} calls remaining this UTC month.`}
                </p>
              </>
            )}
          </div>
          <div className="mt-3">
            <div className="flex justify-between gap-2 text-xs">
              <span className="text-slate-600">AI requests this month</span>
              <span className="font-medium text-slate-700">
                {monthlyAIRequestsUsed === null
                  ? "Usage unavailable"
                  : `${monthlyAIRequestsUsed.toLocaleString()} / ${PLAN_LIMITS[plan].aiMonthlyRequests.toLocaleString()}`}
              </span>
            </div>
            {monthlyAIRequestsUsed !== null && (
              <>
                <div
                  className="mt-1.5 h-2 overflow-hidden rounded bg-slate-100"
                  role="meter"
                  aria-label="Monthly AI request usage"
                  aria-valuemin={0}
                  aria-valuemax={PLAN_LIMITS[plan].aiMonthlyRequests}
                  aria-valuenow={Math.min(monthlyAIRequestsUsed, PLAN_LIMITS[plan].aiMonthlyRequests)}
                >
                  <div
                    className={`h-full ${monthlyAIRequestsUsed >= PLAN_LIMITS[plan].aiMonthlyRequests ? "bg-red-500" : "bg-violet-500"}`}
                    style={{ width: `${Math.min(100, (monthlyAIRequestsUsed / PLAN_LIMITS[plan].aiMonthlyRequests) * 100)}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {monthlyAIRequestsUsed >= PLAN_LIMITS[plan].aiMonthlyRequests
                    ? "Monthly AI request limit reached; Baseten requests are blocked until the next UTC month or a plan change."
                    : `${(PLAN_LIMITS[plan].aiMonthlyRequests - monthlyAIRequestsUsed).toLocaleString()} AI requests remaining this UTC month. Playground runs can use multiple requests.`}
                </p>
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
