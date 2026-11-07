import assert from "node:assert/strict";
import test from "node:test";
import { calculateReliabilityScore } from "./reliability-score.ts";

const run = (status, day) => ({
  status,
  created_at: new Date(Date.UTC(2026, 9, day)).toISOString(),
});

test("returns an explicit insufficient score for empty history", () => {
  assert.deepEqual(calculateReliabilityScore([]), {
    score: null,
    previousScore: null,
    change: null,
    sampleSize: 0,
    totalRuns: 0,
    trend: "insufficient",
  });
});

test("reports the recent pass rate and change versus the preceding window", () => {
  const score = calculateReliabilityScore([
    run("passed", 7),
    run("passed", 6),
    run("failed", 5),
    run("failed", 4),
  ]);
  assert.deepEqual(score, {
    score: 100,
    previousScore: 0,
    change: 100,
    sampleSize: 2,
    totalRuns: 4,
    trend: "improving",
  });
});

test("caps the current score sample at 20 valid regression outcomes", () => {
  const runs = [
    ...Array.from({ length: 20 }, (_, index) => run("failed", 20 - index)),
    ...Array.from({ length: 20 }, (_, index) => run("passed", 40 - index)),
  ];
  const score = calculateReliabilityScore(runs);
  assert.equal(score.score, 100);
  assert.equal(score.sampleSize, 20);
  assert.equal(score.previousScore, 0);
  assert.equal(score.totalRuns, 40);
});

test("ignores invalid and unknown outcomes and reports small-sample trend safely", () => {
  const score = calculateReliabilityScore([
    run("passed", 7),
    { status: "running", created_at: "2026-10-06T00:00:00.000Z" },
    { status: "failed", created_at: "invalid" },
  ]);
  assert.equal(score.score, 100);
  assert.equal(score.sampleSize, 1);
  assert.equal(score.previousScore, null);
  assert.equal(score.trend, "insufficient");
});
