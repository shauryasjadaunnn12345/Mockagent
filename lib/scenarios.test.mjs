import assert from "node:assert/strict";
import test from "node:test";
import {
  parseScenarios,
  resolveScenario,
  resolveScenarioResponse,
  resolveScenarioStep,
} from "./scenarios.ts";

test("validates scenarios and preserves first-match precedence", () => {
  const scenarios = parseScenarios([
    {
      name: "Specific",
      match: { type: "object", properties: { tier: { const: "vip" } }, required: ["tier"] },
      response: { message: "VIP" },
    },
    {
      name: "Fallback",
      match: { type: "object" },
      response: { message: "General" },
    },
  ]);
  assert.equal(resolveScenario(scenarios, { tier: "vip" })?.name, "Specific");
  assert.equal(resolveScenario(scenarios, { tier: "standard" })?.name, "Fallback");
  assert.throws(() => parseScenarios([{ name: "Missing response", match: { type: "object" } }]), /either response or responses/);
});

test("previews selected response-sequence steps and clamps past the final step", () => {
  const scenario = parseScenarios([{
    name: "Retry",
    match: { type: "object" },
    responses: [{ attempt: 1 }, { attempt: 2 }],
  }])[0];
  assert.deepEqual(resolveScenarioResponse(scenario, 1), { attempt: 1 });
  assert.deepEqual(resolveScenarioResponse(scenario, 2), { attempt: 2 });
  assert.deepEqual(resolveScenarioResponse(scenario, 10), { attempt: 2 });
});

test("keeps scheduled transient failures on scenarios without changing normal response parsing", () => {
  const scenario = parseScenarios([{
    name: "Retry once",
    match: { type: "object" },
    responses: [{ status: "retrying" }, { status: "ready" }],
    failures: [{
      step: 1,
      status: 503,
      errorCode: "UPSTREAM_UNAVAILABLE",
      message: "Retry this request.",
      retryAfterSeconds: 1,
    }, {
      step: 3,
      status: 429,
      errorCode: "RATE_LIMITED",
      message: "Wait before retrying.",
    }],
  }])[0];

  assert.equal(scenario.failures?.[0].status, 503);
  assert.deepEqual(resolveScenarioResponse(scenario, 2), { status: "ready" });
  assert.deepEqual(resolveScenarioStep(scenario, 0), {
    attempt: 1,
    responseStep: 1,
    failure: scenario.failures[0],
  });
  assert.deepEqual(resolveScenarioStep(scenario, 1), {
    attempt: 2,
    responseStep: 2,
    failure: null,
  });
  assert.deepEqual(resolveScenarioStep(scenario, 2), {
    attempt: 3,
    responseStep: 2,
    failure: scenario.failures[1],
  });
  assert.throws(() => parseScenarios([{
    name: "Invalid failure",
    match: { type: "object" },
    response: {},
    failures: [{ step: 1, status: 418, errorCode: "TEAPOT", message: "No." }],
  }]), /status must be 401, 409, 429, 500, 502, 503, or 504/);
});
