import assert from "node:assert/strict";
import test from "node:test";
import {
  parseScenarios,
  resolveScenario,
  resolveScenarioResponse,
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
