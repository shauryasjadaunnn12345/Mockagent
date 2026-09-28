"use client";

import { useState, useTransition } from "react";
import { createBillingPortalSession, createCheckoutSession } from "@/app/actions/billing";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkspacePlan } from "@/lib/billing";
import { CreditCard } from "lucide-react";

interface BillingPanelProps {
  workspaceId: string;
  plan: WorkspacePlan;
  status: string;
  periodEnd: string | null;
  hasCustomer: boolean;
  canManage: boolean;
}

const plans = [
  { id: "solo" as const, name: "Solo", price: "$19/mo", detail: "20,000 calls · 25 tools · 30-day logs" },
  { id: "team" as const, name: "Team", price: "$79/mo", detail: "100,000 calls · 250 tools · 10 seats · 90-day logs" },
];

export function BillingPanel({ workspaceId, plan, status, periodEnd, hasCustomer, canManage }: BillingPanelProps) {
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
        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {canManage && (
          <div className="flex flex-wrap gap-2">
            {hasCustomer && <Button type="button" variant="outline" disabled={isPending} onClick={openPortal}>Manage subscription</Button>}
            {plan === "free" && plans.map((candidate) => (
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
      </CardContent>
    </Card>
  );
}
