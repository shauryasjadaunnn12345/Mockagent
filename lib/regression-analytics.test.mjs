import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRegressionRuns } from "./regression-analytics.ts";

const now = new Date("2026-10-27T12:00:00.000Z");

function run({ suite = "suite-1", status = "passed", checks = [], model = "muse", calls = 0, daysAgo = 0 } = {}) {
  const created = new Date(now);
  created.setUTCDate(created.getUTCDate() - daysAgo);
  return {
    suite_id: suite,
    status,
    checks,
    model,
    trace: { calls: Array.from({ length: calls }, () => ({ toolId: "tool-1", status: 200 })) },
    created_at: created.toISOString(),
  };
}

test("returns safe empty analytics with no prior history", () => {
  const analytics = analyzeRegressionRuns([], now);
  assert.equal(analytics.totalRuns, 0);
  assert.equal(analytics.passRate, 0);
  assert.equal(analytics.recentPassRate, null);
  assert.equal(analytics.previousPassRate, null);
  assert.equal(analytics.trend, "insufficient");
  assert.equal(analytics.averageToolCalls, null);
  assert.equal(analytics.days.length, 7);
  assert.equal(analytics.days.reduce((sum, day) => sum + day.passed + day.failed, 0), 0);
});

test("computes overall, daily, suite, model, and tool-call analytics", () => {
  const analytics = analyzeRegressionRuns([
    run({ status: "passed", checks: [{ name: "status", passed: true }], calls: 2 }),
    run({ status: "failed", checks: [{ name: "status", passed: false }], calls: 4 }),
    run({ suite: "suite-2", model: "other", daysAgo: 1, status: "passed", calls: 0 }),
  ], now);

  assert.equal(analytics.totalRuns, 3);
  assert.equal(analytics.passedRuns, 2);
  assert.equal(analytics.failedRuns, 1);
  assert.equal(analytics.passRate, 67);
  assert.equal(analytics.averageToolCalls, 2);
  assert.equal(analytics.suites.length, 2);
  assert.equal(analytics.suites[0].suiteId, "suite-1");
  assert.deepEqual(analytics.suites[0].streak, { status: "passed", count: 1 });
  assert.equal(analytics.failingChecks[0].failureRate, 50);
  assert.equal(analytics.models.length, 2);
  assert.equal(analytics.days.find((day) => day.date === "2026-10-26").passed, 1);
});

test("compares recent and previous windows to expose regressions and improvements", () => {
  const regressing = analyzeRegressionRuns([
    ...Array.from({ length: 5 }, () => run({ status: "failed" })),
    ...Array.from({ length: 5 }, () => run({ status: "passed", daysAgo: 1 })),
  ], now);
  assert.equal(regressing.recentPassRate, 0);
  assert.equal(regressing.previousPassRate, 100);
  assert.equal(regressing.trend, "regressing");
  assert.deepEqual(regressing.suites[0].streak, { status: "failed", count: 5 });

  const improving = analyzeRegressionRuns([
    ...Array.from({ length: 4 }, () => run({ status: "passed" })),
    ...Array.from({ length: 4 }, () => run({ status: "failed", daysAgo: 1 })),
  ], now);
  assert.equal(improving.trend, "improving");
});

test("does not claim a trend until both comparison windows are available", () => {
  const analytics = analyzeRegressionRuns([run(), run({ daysAgo: 1 })], now);
  assert.equal(analytics.recentPassRate, 100);
  assert.equal(analytics.previousPassRate, 100);
  assert.equal(analytics.trend, "stable");

  const oneRun = analyzeRegressionRuns([run()], now);
  assert.equal(oneRun.trend, "insufficient");
});

test("ignores malformed checks, invalid timestamps, and unknown statuses", () => {
  const analytics = analyzeRegressionRuns([
    run({ checks: [null, { name: "good", passed: true }, { name: "bad", passed: "false" }, { name: "bad", passed: false }] }),
    { ...run(), status: "unknown" },
    { ...run(), created_at: "invalid" },
  ], now);
  assert.equal(analytics.totalRuns, 1);
  assert.deepEqual(analytics.failingChecks.map((check) => check.name), ["bad"]);
});

test("handles malformed traces and multiple failing check categories", () => {
  const analytics = analyzeRegressionRuns([
    {
      ...run({ status: "failed", checks: [
        { name: "Tool call succeeded", passed: false },
        { name: "Answer phrase", passed: false },
      ] }),
      trace: { calls: [{ toolId: "x" }, null] },
    },
    {
      ...run({ status: "passed", checks: [
        { name: "Tool call succeeded", passed: true },
        { name: "Answer phrase", passed: true },
      ] }),
      trace: { calls: [{ toolId: "x" }, null] },
    },
  ], now);
  assert.equal(analytics.averageToolCalls, null);
  assert.deepEqual(analytics.failingChecks.map((check) => [check.name, check.failures, check.failureRate]), [
    ["Answer phrase", 1, 50],
    ["Tool call succeeded", 1, 50],
  ]);
});

test("sorts suites by lowest pass rate and honors chronological order", () => {
  const analytics = analyzeRegressionRuns([
    run({ suite: "healthy", status: "passed" }),
    run({ suite: "flaky", status: "failed" }),
    run({ suite: "flaky", status: "passed", daysAgo: 1 }),
    run({ suite: "healthy", status: "passed", daysAgo: 2 }),
  ], now);
  assert.deepEqual(analytics.suites.map((suite) => suite.suiteId), ["flaky", "healthy"]);
  assert.equal(analytics.suites[0].latestStatus, "failed");
  assert.equal(analytics.suites[0].passRate, 50);
});
