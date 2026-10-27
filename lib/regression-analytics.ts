export interface AnalyticsRun {
  suite_id: string;
  status: string;
  checks: unknown;
  model: string;
  trace: unknown;
  created_at: string;
}

export interface RegressionAnalytics {
  totalRuns: number;
  passedRuns: number;
  failedRuns: number;
  passRate: number;
  recentPassRate: number | null;
  previousPassRate: number | null;
  trend: "improving" | "regressing" | "stable" | "insufficient";
  days: Array<{ date: string; passed: number; failed: number }>;
  suites: Array<{
    suiteId: string;
    totalRuns: number;
    passedRuns: number;
    passRate: number;
    latestStatus: "passed" | "failed";
    latestAt: string;
    streak: { status: "passed" | "failed"; count: number };
  }>;
  failingChecks: Array<{ name: string; failures: number; evaluations: number; failureRate: number }>;
  models: Array<{ name: string; totalRuns: number; passedRuns: number; passRate: number }>;
  averageToolCalls: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readChecks(value: unknown): Array<{ name: string; passed: boolean }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((check) =>
    isRecord(check) && typeof check.name === "string" && typeof check.passed === "boolean"
      ? [{ name: check.name, passed: check.passed }]
      : []
  );
}

function readToolCallCount(value: unknown): number | null {
  if (!isRecord(value) || !Array.isArray(value.calls)) return null;
  if (!value.calls.every((call) =>
    isRecord(call) &&
    typeof call.toolId === "string" &&
    typeof call.status === "number"
  )) return null;
  return value.calls.length;
}

function percentage(part: number, total: number): number {
  return total === 0 ? 0 : Math.round((part / total) * 100);
}

function compareRates(recent: number | null, previous: number | null): RegressionAnalytics["trend"] {
  if (recent === null || previous === null) return "insufficient";
  if (recent > previous) return "improving";
  if (recent < previous) return "regressing";
  return "stable";
}

export function analyzeRegressionRuns(runs: AnalyticsRun[], now = new Date()): RegressionAnalytics {
  const orderedRuns = runs
    .filter((run) => (run.status === "passed" || run.status === "failed") && Number.isFinite(Date.parse(run.created_at)))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at));
  const passedRuns = orderedRuns.filter((run) => run.status === "passed").length;
  const failedRuns = orderedRuns.length - passedRuns;
  const comparisonCount = Math.min(10, Math.floor(orderedRuns.length / 2));
  const recentRuns = comparisonCount > 0 ? orderedRuns.slice(0, comparisonCount) : [];
  const previousRuns = comparisonCount > 0
    ? orderedRuns.slice(comparisonCount, comparisonCount * 2)
    : [];
  const recentPassRate = comparisonCount > 0
    ? percentage(recentRuns.filter((run) => run.status === "passed").length, recentRuns.length)
    : null;
  const previousPassRate = comparisonCount > 0
    ? percentage(previousRuns.filter((run) => run.status === "passed").length, previousRuns.length)
    : null;

  const dayMap = new Map<string, { date: string; passed: number; failed: number }>();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() - offset);
    const date = day.toISOString().slice(0, 10);
    dayMap.set(date, { date, passed: 0, failed: 0 });
  }
  for (const run of orderedRuns) {
    const day = dayMap.get(run.created_at.slice(0, 10));
    if (day) day[run.status === "passed" ? "passed" : "failed"] += 1;
  }

  const runsBySuite = new Map<string, AnalyticsRun[]>();
  const checksByName = new Map<string, { failures: number; evaluations: number }>();
  const runsByModel = new Map<string, { totalRuns: number; passedRuns: number }>();
  let observedToolCalls = 0;
  let toolCallRunCount = 0;

  for (const run of orderedRuns) {
    const suiteRuns = runsBySuite.get(run.suite_id) ?? [];
    suiteRuns.push(run);
    runsBySuite.set(run.suite_id, suiteRuns);

    for (const check of readChecks(run.checks)) {
      const aggregate = checksByName.get(check.name) ?? { failures: 0, evaluations: 0 };
      aggregate.evaluations += 1;
      if (!check.passed) aggregate.failures += 1;
      checksByName.set(check.name, aggregate);
    }

    const modelName = run.model.trim() || "Unknown model";
    const modelAggregate = runsByModel.get(modelName) ?? { totalRuns: 0, passedRuns: 0 };
    modelAggregate.totalRuns += 1;
    if (run.status === "passed") modelAggregate.passedRuns += 1;
    runsByModel.set(modelName, modelAggregate);

    const toolCallCount = readToolCallCount(run.trace);
    if (toolCallCount !== null) {
      observedToolCalls += toolCallCount;
      toolCallRunCount += 1;
    }
  }

  const suites = [...runsBySuite.entries()].map(([suiteId, suiteRuns]) => {
    const suitePassedRuns = suiteRuns.filter((run) => run.status === "passed").length;
    const latestStatus = suiteRuns[0].status as "passed" | "failed";
    let streakCount = 0;
    for (const run of suiteRuns) {
      if (run.status !== latestStatus) break;
      streakCount += 1;
    }
    return {
      suiteId,
      totalRuns: suiteRuns.length,
      passedRuns: suitePassedRuns,
      passRate: percentage(suitePassedRuns, suiteRuns.length),
      latestStatus,
      latestAt: suiteRuns[0].created_at,
      streak: { status: latestStatus, count: streakCount },
    };
  }).sort((left, right) => left.passRate - right.passRate || left.suiteId.localeCompare(right.suiteId));

  const failingChecks = [...checksByName.entries()]
    .map(([name, counts]) => ({
      name,
      ...counts,
      failureRate: percentage(counts.failures, counts.evaluations),
    }))
    .filter((check) => check.failures > 0)
    .sort((left, right) => right.failures - left.failures || right.failureRate - left.failureRate || left.name.localeCompare(right.name));

  const models = [...runsByModel.entries()]
    .map(([name, counts]) => ({
      name,
      ...counts,
      passRate: percentage(counts.passedRuns, counts.totalRuns),
    }))
    .sort((left, right) => right.totalRuns - left.totalRuns || left.name.localeCompare(right.name));

  return {
    totalRuns: orderedRuns.length,
    passedRuns,
    failedRuns,
    passRate: percentage(passedRuns, orderedRuns.length),
    recentPassRate,
    previousPassRate,
    trend: compareRates(recentPassRate, previousPassRate),
    days: [...dayMap.values()],
    suites,
    failingChecks,
    models,
    averageToolCalls: toolCallRunCount > 0 ? Math.round((observedToolCalls / toolCallRunCount) * 10) / 10 : null,
  };
}
