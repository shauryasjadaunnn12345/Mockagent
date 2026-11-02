import assert from "node:assert/strict";
import test from "node:test";
import {
  createCoverageImprovement,
  parseAutoImproveRoundLimit,
  shouldContinueAutoImprove,
} from "./auto-improve.ts";

test("calculates coverage deltas per improvement round", () => {
  assert.deepEqual(createCoverageImprovement(1, 40, 85), {
    round: 1,
    before: 40,
    after: 85,
    delta: 45,
  });
  assert.deepEqual(createCoverageImprovement(2, 85, 80), {
    round: 2,
    before: 85,
    after: 80,
    delta: -5,
  });
});

test("limits the configurable auto-improve run to two or three rounds", () => {
  assert.equal(parseAutoImproveRoundLimit(2), 2);
  assert.equal(parseAutoImproveRoundLimit(3), 3);
  assert.throws(() => parseAutoImproveRoundLimit(4), /2 or 3 rounds/);
  assert.throws(() => createCoverageImprovement(4, 20, 40), /invalid/);
  assert.throws(() => createCoverageImprovement(1, -1, 40), /invalid/);
});

test("continues only while the round budget and uncovered points remain", () => {
  assert.equal(shouldContinueAutoImprove(0, 2, 4), true);
  assert.equal(shouldContinueAutoImprove(2, 2, 4), false);
  assert.equal(shouldContinueAutoImprove(1, 3, 0), false);
});
