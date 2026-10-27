import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAN_LIMITS,
  SUBSCRIPTION_STATUSES,
  aiMonthlyRequestLimit,
  checkoutRestriction,
  effectiveWorkspacePlan,
  isPaidEntitlementStatus,
  isTerminalSubscriptionStatus,
  shouldIgnoreSubscriptionUpdate,
} from "./billing.ts";

test("keeps plan limits consistent with the advertised free and paid tiers", () => {
  assert.deepEqual(PLAN_LIMITS.free, {
    monthlyCalls: 1000,
    aiMonthlyRequests: 100,
    tools: 3,
    seats: 1,
    apiKeys: 2,
    retentionDays: 7,
  });
  assert.deepEqual(PLAN_LIMITS.solo, {
    monthlyCalls: 20000,
    aiMonthlyRequests: 1000,
    tools: 25,
    seats: 1,
    apiKeys: 10,
    retentionDays: 30,
  });
  assert.deepEqual(PLAN_LIMITS.team, {
    monthlyCalls: 100000,
    aiMonthlyRequests: 5000,
    tools: 250,
    seats: 10,
    apiKeys: 50,
    retentionDays: 90,
  });
});

test("grants paid entitlements only to active and past-due subscriptions", () => {
  assert.equal(effectiveWorkspacePlan("solo", "active"), "solo");
  assert.equal(effectiveWorkspacePlan("team", "past_due"), "team");
  for (const status of SUBSCRIPTION_STATUSES.filter((value) => value !== "active" && value !== "past_due")) {
    assert.equal(effectiveWorkspacePlan("team", status), "free", status);
  }
  assert.equal(effectiveWorkspacePlan("unknown", "active"), "free");
  assert.equal(isPaidEntitlementStatus("active"), true);
  assert.equal(isPaidEntitlementStatus("past_due"), true);
  assert.equal(isPaidEntitlementStatus("on_hold"), false);
});

test("applies monthly AI request caps to the effective plan", () => {
  assert.equal(aiMonthlyRequestLimit("free", "free"), 100);
  assert.equal(aiMonthlyRequestLimit("solo", "active"), 1000);
  assert.equal(aiMonthlyRequestLimit("team", "past_due"), 5000);
  assert.equal(aiMonthlyRequestLimit("team", "paused"), 100);
  assert.equal(aiMonthlyRequestLimit("unknown", "active"), 100);
});

test("blocks duplicate checkouts while allowing a checkout after a terminal state", () => {
  assert.equal(checkoutRestriction(null, "free"), null);
  assert.equal(checkoutRestriction(null, "cancelled"), null);
  assert.match(checkoutRestriction(null, "active"), /Manage the current subscription/);
  assert.match(checkoutRestriction(null, "past_due"), /Manage the current subscription/);
  assert.match(checkoutRestriction("sub-existing", "cancelled"), /already has a subscription/);
});

test("recognizes terminal statuses and ignores stale subscription updates", () => {
  assert.equal(isTerminalSubscriptionStatus("cancelled"), true);
  assert.equal(isTerminalSubscriptionStatus("failed"), true);
  assert.equal(isTerminalSubscriptionStatus("expired"), true);
  assert.equal(isTerminalSubscriptionStatus("paused"), false);
  assert.equal(shouldIgnoreSubscriptionUpdate("sub-new", "sub-old"), true);
  assert.equal(shouldIgnoreSubscriptionUpdate("sub-new", "sub-new"), false);
  assert.equal(shouldIgnoreSubscriptionUpdate(null, "sub-first"), false);
});
