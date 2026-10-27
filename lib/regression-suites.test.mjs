import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateRegressionTest,
  parseRegressionSuiteInput,
} from "./regression-suites.ts";

const validInput = {
  name: " Refund happy path ",
  prompt: " Refund order 123 ",
  toolIds: ["lookup", "refund"],
  expectedToolIds: ["lookup", "refund"],
  requiredAnswerText: ["Refund processed"],
  responseAssertions: [],
};

test("normalizes a valid regression test", () => {
  assert.deepEqual(parseRegressionSuiteInput(validInput), {
    name: "Refund happy path",
    prompt: "Refund order 123",
    testCases: [{ name: "Case 1", prompt: "Refund order 123" }],
    toolIds: ["lookup", "refund"],
    expectedToolIds: ["lookup", "refund"],
    requiredAnswerText: ["Refund processed"],
    responseAssertions: [],
  });
});

test("normalizes multiple named test cases and keeps the first prompt for compatibility", () => {
  const parsed = parseRegressionSuiteInput({
    ...validInput,
    testCases: [
      { name: "VIP order", prompt: "Refund VIP order 123" },
      { name: "Standard order", prompt: "Check standard order 456" },
    ],
  });
  assert.equal(parsed.prompt, "Refund VIP order 123");
  assert.deepEqual(parsed.testCases, [
    { name: "VIP order", prompt: "Refund VIP order 123" },
    { name: "Standard order", prompt: "Check standard order 456" },
  ]);
});

test("bounds test case count, prompt sizes, combined text, and unique names", () => {
  assert.throws(
    () => parseRegressionSuiteInput({
      ...validInput,
      testCases: [{ name: "Case", prompt: "one" }, { name: "case", prompt: "two" }],
    }),
    /duplicated/,
  );
  assert.throws(
    () => parseRegressionSuiteInput({
      ...validInput,
      testCases: Array.from({ length: 21 }, (_, index) => ({ name: `Case ${index}`, prompt: "x" })),
    }),
    /between 1 and 20/,
  );
  assert.throws(
    () => parseRegressionSuiteInput({
      ...validInput,
      testCases: [{ name: "Long", prompt: "x".repeat(5001) }],
    }),
    /at most 5,000 characters/,
  );
});

test("requires a tool or answer expectation and constrains selected tools", () => {
  assert.throws(
    () => parseRegressionSuiteInput({ ...validInput, expectedToolIds: null, requiredAnswerText: [] }),
    /Add a tool sequence/,
  );
  assert.throws(
    () => parseRegressionSuiteInput({ ...validInput, expectedToolIds: ["outside"] }),
    /only selected tools/,
  );
});

test("validates response assertions and permits them as the only expectation", () => {
  const parsed = parseRegressionSuiteInput({
    ...validInput,
    expectedToolIds: null,
    requiredAnswerText: [],
    responseAssertions: [{
      toolId: "lookup",
      path: "data.items.0.status",
      operator: "equals",
      expected: "ready",
    }],
  });
  assert.deepEqual(parsed.responseAssertions, [{
    toolId: "lookup",
    path: "data.items.0.status",
    operator: "equals",
    expected: "ready",
  }]);

  assert.throws(
    () => parseRegressionSuiteInput({
      ...validInput,
      responseAssertions: [{ toolId: "outside", path: "status", operator: "exists" }],
    }),
    /selected tool/,
  );
  assert.throws(
    () => parseRegressionSuiteInput({
      ...validInput,
      responseAssertions: [{ toolId: "lookup", path: "__proto__.x", operator: "exists" }],
    }),
    /safe dot-separated JSON path/,
  );
  assert.throws(
    () => parseRegressionSuiteInput({
      ...validInput,
      responseAssertions: [{ toolId: "lookup", path: "count", operator: "greater_than", expected: "2" }],
    }),
    /JSON number/,
  );
});

test("rejects malformed, duplicate, or oversized fields", () => {
  assert.throws(() => parseRegressionSuiteInput(null), /must be an object/);
  assert.throws(
    () => parseRegressionSuiteInput({ ...validInput, toolIds: ["lookup", "lookup"] }),
    /must be unique/,
  );
  assert.throws(
    () => parseRegressionSuiteInput({ ...validInput, name: "x".repeat(81) }),
    /at most 80 characters/,
  );
  assert.throws(
    () => parseRegressionSuiteInput({ ...validInput, prompt: "x".repeat(5001) }),
    /at most 5,000 characters/,
  );
});

test("passes only when ordered tool calls and all phrases match", () => {
  const passed = evaluateRegressionTest(
    ["lookup", "refund"],
    ["processed", "order 123"],
    ["lookup", "refund"],
    "Order 123 refund processed.",
    [200, 201],
  );
  assert.equal(passed.passed, true);
  assert.equal(passed.checks.length, 4);

  const failed = evaluateRegressionTest(
    ["lookup", "refund"],
    ["processed"],
    ["refund", "lookup"],
    "Refund was queued.",
    [200, 200],
  );
  assert.equal(failed.passed, false);
  assert.equal(failed.checks.some((check) => !check.passed), true);
});

test("fails a regression run when a tool request returns an error", () => {
  const result = evaluateRegressionTest(null, ["processed"], ["refund"], "Refund processed.", [400]);
  assert.equal(result.passed, false);
  assert.equal(result.checks[0].name, "All tool calls succeeded");
  assert.equal(result.checks[0].passed, false);
});

test("supports explicitly asserting that no tools are called", () => {
  assert.equal(
    evaluateRegressionTest([], ["No lookup needed"], [], "No lookup needed.").passed,
    true,
  );
  assert.equal(evaluateRegressionTest([], [], ["lookup"], "").passed, false);
});

test("evaluates tool-response paths with equality, containment, existence, and numeric operators", () => {
  const assertions = [
    { toolId: "lookup", path: "data.status", operator: "equals", expected: "ready" },
    { toolId: "lookup", path: "data.tags", operator: "contains", expected: "priority" },
    { toolId: "lookup", path: "data.items.0.id", operator: "exists" },
    { toolId: "lookup", path: "data.total", operator: "greater_than", expected: 10 },
    { toolId: "lookup", path: "data.total", operator: "less_than", expected: 20 },
  ];
  const result = evaluateRegressionTest(
    null,
    [],
    ["lookup"],
    "done",
    [200],
    [{
      toolId: "lookup",
      response: {
        data: {
          status: "ready",
          tags: ["priority", "new"],
          items: [{ id: "A-1" }],
          total: 15,
        },
      },
    }],
    assertions,
  );
  assert.equal(result.passed, true);
  assert.equal(result.checks.length, assertions.length + 1);
});

test("compares JSON objects independent of property order", () => {
  const result = evaluateRegressionTest(
    null,
    [],
    ["lookup"],
    "done",
    [200],
    [{ toolId: "lookup", response: { data: { id: 1, status: "ready" } } }],
    [{ toolId: "lookup", path: "data", operator: "equals", expected: { status: "ready", id: 1 } }],
  );
  assert.equal(result.checks[1].passed, true);
});

test("fails response assertions when a tool or response field is missing", () => {
  const assertions = [
    { toolId: "lookup", path: "data.status", operator: "equals", expected: "ready" },
    { toolId: "refund", path: "accepted", operator: "exists" },
  ];
  const result = evaluateRegressionTest(null, [], [], "", [], [], assertions);
  assert.equal(result.passed, false);
  assert.equal(result.checks[1].actual, "tool not called");
  assert.equal(result.checks[2].actual, "tool not called");
});
