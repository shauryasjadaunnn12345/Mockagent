export type PaidPlan = "solo" | "team";
export type WorkspacePlan = "free" | PaidPlan;

export const PLAN_LIMITS = {
  free: { monthlyCalls: 1_000, aiMonthlyRequests: 100, tools: 3, seats: 1, apiKeys: 2, retentionDays: 7 },
  solo: { monthlyCalls: 20_000, aiMonthlyRequests: 1_000, tools: 25, seats: 1, apiKeys: 10, retentionDays: 30 },
  team: { monthlyCalls: 100_000, aiMonthlyRequests: 5_000, tools: 250, seats: 10, apiKeys: 50, retentionDays: 90 },
} as const;

export const SUBSCRIPTION_STATUSES = [
  "free",
  "pending",
  "active",
  "past_due",
  "on_hold",
  "paused",
  "cancelled",
  "failed",
  "expired",
] as const;

export type SubscriptionStatus = typeof SUBSCRIPTION_STATUSES[number];

export function isPaidEntitlementStatus(status: string): status is "active" | "past_due" {
  return status === "active" || status === "past_due";
}

export function effectiveWorkspacePlan(plan: string, status: string): WorkspacePlan {
  if (!isPaidEntitlementStatus(status)) return "free";
  return plan === "solo" || plan === "team" ? plan : "free";
}

export function aiMonthlyRequestLimit(plan: string, status: string): number {
  return PLAN_LIMITS[effectiveWorkspacePlan(plan, status)].aiMonthlyRequests;
}

export function checkoutRestriction(
  subscriptionId: string | null,
  status: string
): string | null {
  if (subscriptionId) {
    return "This workspace already has a subscription. Manage it in the billing portal.";
  }
  if (status === "active" || status === "past_due") {
    return "Manage the current subscription in the billing portal.";
  }
  return null;
}

export function isTerminalSubscriptionStatus(status: string): boolean {
  return status === "cancelled" || status === "failed" || status === "expired";
}

export function shouldIgnoreSubscriptionUpdate(
  currentSubscriptionId: string | null,
  incomingSubscriptionId: string
): boolean {
  return currentSubscriptionId !== null && currentSubscriptionId !== incomingSubscriptionId;
}

export function dodoProductId(plan: PaidPlan): string | null {
  return plan === "solo"
    ? process.env.DODO_PAYMENTS_SOLO_PRODUCT_ID ?? null
    : process.env.DODO_PAYMENTS_TEAM_PRODUCT_ID ?? null;
}