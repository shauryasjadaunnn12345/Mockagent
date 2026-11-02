export const MAX_AUTO_IMPROVE_ROUNDS = 3;
export const DEFAULT_AUTO_IMPROVE_ROUNDS = 2;

export type AutoImproveRoundLimit = 2 | 3;

export interface CoverageImprovement {
  round: number;
  before: number;
  after: number;
  delta: number;
}

export function parseAutoImproveRoundLimit(value: unknown): AutoImproveRoundLimit {
  if (value === 2 || value === 3) return value;
  throw new Error("Auto-improve is limited to 2 or 3 rounds.");
}

export function createCoverageImprovement(
  round: number,
  before: number,
  after: number,
): CoverageImprovement {
  if (
    !Number.isInteger(round) ||
    round < 1 ||
    round > MAX_AUTO_IMPROVE_ROUNDS ||
    !Number.isInteger(before) ||
    before < 0 ||
    before > 100 ||
    !Number.isInteger(after) ||
    after < 0 ||
    after > 100
  ) {
    throw new Error("Coverage improvement values are invalid.");
  }
  return { round, before, after, delta: after - before };
}

export function shouldContinueAutoImprove(
  completedRounds: number,
  roundLimit: AutoImproveRoundLimit,
  remainingGaps: number,
): boolean {
  return Number.isInteger(completedRounds) &&
    completedRounds >= 0 &&
    completedRounds < roundLimit &&
    Number.isInteger(remainingGaps) &&
    remainingGaps > 0;
}
