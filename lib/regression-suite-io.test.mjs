import assert from "node:assert/strict";
import test from "node:test";
import {
  createRegressionSuiteBundle,
  mapImportedRegressionSuiteTools,
  MAX_REGRESSION_SUITE_BUNDLE_BYTES,
  parseRegressionSuiteBundle,
} from "./regression-suite-io.ts";

const suite = {
  name: "Happy path",
  prompt: "Check order 42",
  testCases: [{ name: "Standard", prompt: "Check order 42" }],
  toolNames: ["lookup_order"],
  expectedToolNames: ["lookup_order"],
  requiredAnswerText: ["ready"],
  forbiddenAnswerText: ["leaked"],
  responseAssertions: [],
  semanticCriteria: null,
};

test("exports and imports a versioned suite bundle without workspace identifiers", () => {
  const bundle = createRegressionSuiteBundle([suite]);
  assert.equal(bundle.format, "mockagent-regression-suites");
  assert.equal(bundle.version, 1);
  assert.deepEqual(parseRegressionSuiteBundle(JSON.stringify(bundle)), [{
    suite: {
      name: "Happy path",
      prompt: "Check order 42",
      testCases: [{ name: "Standard", prompt: "Check order 42" }],
      toolIds: ["lookup_order"],
      expectedToolIds: ["lookup_order"],
      requiredAnswerText: ["ready"],
      forbiddenAnswerText: ["leaked"],
      responseAssertions: [],
      semanticCriteria: null,
    },
    toolNames: ["lookup_order"],
    expectedToolNames: ["lookup_order"],
  }]);
  assert.equal("id" in bundle.suites[0], false);
  assert.equal("workspace_id" in bundle.suites[0], false);
});

test("imports version 1 bundles created before forbidden-answer checks", () => {
  const bundle = createRegressionSuiteBundle([suite]);
  delete bundle.suites[0].forbiddenAnswerText;
  const imported = parseRegressionSuiteBundle(JSON.stringify(bundle));
  assert.deepEqual(imported[0].suite.forbiddenAnswerText, []);
});

test("rejects malformed, unsupported, oversized, and invalid suite bundles", () => {
  assert.throws(() => parseRegressionSuiteBundle("{"), /valid JSON/);
  assert.throws(() => parseRegressionSuiteBundle(JSON.stringify({ format: "other", version: 1, suites: [suite] })), /not a supported/);
  assert.throws(() => parseRegressionSuiteBundle(JSON.stringify({ format: "mockagent-regression-suites", version: 2, suites: [suite] })), /not a supported/);
  assert.throws(() => parseRegressionSuiteBundle("x".repeat(MAX_REGRESSION_SUITE_BUNDLE_BYTES + 1)), /1 MB or smaller/);
  assert.throws(() => parseRegressionSuiteBundle(JSON.stringify({
    format: "mockagent-regression-suites",
    version: 1,
    suites: [{ ...suite, expectedToolNames: ["foreign"] }],
  })), /only selected tools/);
});

test("maps portable tool names to destination IDs, including response assertions", () => {
  const imported = parseRegressionSuiteBundle(JSON.stringify(createRegressionSuiteBundle([{
    ...suite,
    responseAssertions: [{
      toolId: "lookup_order",
      path: "status",
      operator: "equals",
      expected: "ready",
    }],
  }])))[0];
  assert.throws(() => mapImportedRegressionSuiteTools(imported, {}), /Map exported tool/);
  const mapped = mapImportedRegressionSuiteTools(imported, { lookup_order: "workspace-tool-id" });
  assert.deepEqual(mapped.toolIds, ["workspace-tool-id"]);
  assert.deepEqual(mapped.expectedToolIds, ["workspace-tool-id"]);
  assert.equal(mapped.responseAssertions[0].toolId, "workspace-tool-id");
});
