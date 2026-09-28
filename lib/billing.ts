export type PaidPlan = "solo" | "team";
export type WorkspacePlan = "free" | PaidPlan;

export const PLAN_LIMITS = {
  free: { monthlyCalls: 1_000, tools: 3, seats: 1, apiKeys: 2, retentionDays: 7 },
  solo: { monthlyCalls: 20_000, tools: 25, seats: 1, apiKeys: 10, retentionDays: 30 },
  team: { monthlyCalls: 100_000, tools: 250, seats: 10, apiKeys: 50, retentionDays: 90 },
} as const;

export function dodoProductId(plan: PaidPlan): string | null {
  return plan === "solo"
    ? process.env.DODO_PAYMENTS_SOLO_PRODUCT_ID ?? null
    : process.env.DODO_PAYMENTS_TEAM_PRODUCT_ID ?? null;
}