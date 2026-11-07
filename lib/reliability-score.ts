export interface ReliabilityRun {
  id?: string;
  status: string;
  created_at: string;
}

export interface ReliabilityScore {
  score: number | null;
  previousScore: number | null;
  change: number | null;
  sampleSize: number;
  totalRuns: number;
  trend: "improving" | "regressing" | "stable" | "insufficient";
}

const RELIABILITY_WINDOW_SIZE = 20;

function passRate(runs: ReliabilityRun[]): number {
  return Math.round(
    runs.filter((run) => run.status === "passed").length / runs.length * 100
  );
}

export function calculateReliabilityScore(runs: ReliabilityRun[]): ReliabilityScore {
  const ordered = runs
    .filter((run) =>
      (run.status === "passed" || run.status === "failed") &&
      Number.isFinite(Date.parse(run.created_at))
    )
    .sort((left, right) =>
      Date.parse(right.created_at) - Date.parse(left.created_at) ||
      (right.id ?? "").localeCompare(left.id ?? "")
    );
  if (!ordered.length) {
    return {
      score: null,
      previousScore: null,
      change: null,
      sampleSize: 0,
      totalRuns: 0,
      trend: "insufficient",
    };
  }

  const sampleSize = ordered.length === 1
    ? 1
    : Math.min(RELIABILITY_WINDOW_SIZE, Math.floor(ordered.length / 2));
  const score = passRate(ordered.slice(0, sampleSize));
  if (ordered.length === 1) {
    return {
      score,
      previousScore: null,
      change: null,
      sampleSize,
      totalRuns: 1,
      trend: "insufficient",
    };
  }

  const previousScore = passRate(ordered.slice(sampleSize, sampleSize * 2));
  const change = score - previousScore;
  return {
    score,
    previousScore,
    change,
    sampleSize,
    totalRuns: ordered.length,
    trend: change > 0 ? "improving" : change < 0 ? "regressing" : "stable",
  };
}
