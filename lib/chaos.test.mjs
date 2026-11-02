import assert from "node:assert/strict";
import test from "node:test";
import { parseChaosConfig, resolveInjectedFailure } from "./chaos.ts";

test("parses bounded deterministic transient failures and selects by call step", () => {
  const failures = parseChaosConfig([
    {
      step: 1,
      status: 503,
      errorCode: "UPSTREAM_UNAVAILABLE",
      message: "Retry the request.",
      retryAfterSeconds: 2,
    },
  ]);

  assert.deepEqual(failures, [{
    step: 1,
    status: 503,
    errorCode: "UPSTREAM_UNAVAILABLE",
    message: "Retry the request.",
    retryAfterSeconds: 2,
  }]);
  assert.deepEqual(resolveInjectedFailure(failures, 1), failures[0]);
  assert.equal(resolveInjectedFailure(failures, 2), null);
});

test("rejects unsupported, ambiguous, or unbounded failure definitions", () => {
  assert.throws(() => parseChaosConfig({ step: 1 }), /array/);
  assert.throws(() => parseChaosConfig([{
    step: 0,
    status: 503,
    errorCode: "TEMPORARY",
    message: "Retry.",
  }]), /step must be an integer/);
  assert.throws(() => parseChaosConfig([
    { step: 1, status: 503, errorCode: "TEMPORARY", message: "First." },
    { step: 1, status: 503, errorCode: "TEMPORARY", message: "Second." },
  ]), /configured more than once/);
  assert.throws(() => parseChaosConfig([{
    step: 1,
    status: 418,
    errorCode: "TEAPOT",
    message: "Unsupported.",
  }]), /status must be 429, 500, 502, or 503/);
  assert.throws(() => parseChaosConfig(Array.from({ length: 21 }, (_, index) => ({
    step: index + 1,
    status: 503,
    errorCode: "TEMPORARY",
    message: "Retry.",
  }))), /at most 20 entries/);
});
