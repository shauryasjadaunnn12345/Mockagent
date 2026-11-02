import assert from "node:assert/strict";
import test from "node:test";
import {
  collectRegressionContractReferences,
  parseGeneratedRegressionTestCases,
  parseRegressionContractReview,
  parseRegressionFailureExplanation,
} from "./regression-ai.ts";

test("validates and normalizes AI-generated regression cases", () => {
  assert.deepEqual(parseGeneratedRegressionTestCases({
    test_cases: [
      { name: " Standard order ", prompt: " Check the status of order 123. " },
      { name: "Missing order", prompt: "Look up order missing-404." },
    ],
  }), [
    { name: "Standard order", prompt: "Check the status of order 123." },
    { name: "Missing order", prompt: "Look up order missing-404." },
  ]);
});

test("rejects malformed, oversized, or duplicate AI-generated cases", () => {
  assert.throws(() => parseGeneratedRegressionTestCases(null), /test_cases array/);
  assert.throws(() => parseGeneratedRegressionTestCases({ test_cases: [] }), /between 1 and 6/);
  assert.throws(() => parseGeneratedRegressionTestCases({
    test_cases: [
      { name: "same", prompt: "first" },
      { name: "SAME", prompt: "second" },
    ],
  }), /duplicated/);
  assert.throws(() => parseGeneratedRegressionTestCases({
    test_cases: Array.from({ length: 7 }, (_, index) => ({ name: `case ${index}`, prompt: "test" })),
  }), /between 1 and 6/);
});

test("requires failure explanations to cite real failed checks", () => {
  const failedChecks = ["Exact tool sequence", "lookup response data.status equals \"ready\""];
  assert.deepEqual(parseRegressionFailureExplanation({
    summary: "The agent called the tools in the wrong order.",
    findings: [{
      checkName: "Exact tool sequence",
      explanation: "The observed sequence differs from the expected sequence.",
      suggestedAction: "Inspect the trace and tool-selection instructions.",
    }],
  }, failedChecks), {
    summary: "The agent called the tools in the wrong order.",
    findings: [{
      checkName: "Exact tool sequence",
      explanation: "The observed sequence differs from the expected sequence.",
      suggestedAction: "Inspect the trace and tool-selection instructions.",
    }],
  });
  assert.throws(() => parseRegressionFailureExplanation({
    summary: "Something went wrong.",
    findings: [{
      checkName: "Invented check",
      explanation: "An unsupported explanation.",
      suggestedAction: "Change the prompt.",
    }],
  }, failedChecks), /actual failed check/);
  assert.throws(() => parseRegressionFailureExplanation({
    summary: "",
    findings: [],
  }, failedChecks), /exceeds the supported size/);
});

test("validates contract review severity, tools, and exact JSON-pointer evidence", () => {
  const tools = [{
    name: "lookup_order",
    json_schema: {
      type: "object",
      properties: { status: { enum: ["shipped", "delayed"] } },
    },
    mock_response: { status: "shipped" },
    scenarios: [{ name: "Delayed", match: { properties: { status: { const: "delayed" } } } }],
  }];
  const references = collectRegressionContractReferences(tools);
  const validReview = {
    summary: "One response-contract risk needs a targeted test.",
    findings: [{
      toolName: "lookup_order",
      severity: "medium",
      area: "responses",
      reference: "/mock_response/status",
      risk: "Unexpected status values could be returned without a regression assertion.",
      testPrompt: "Look up an order with an unknown status and explain the result.",
    }],
  };
  assert.deepEqual(
    parseRegressionContractReview(validReview, ["lookup_order"], references),
    validReview,
  );
  assert.throws(() => parseRegressionContractReview({
    ...validReview,
    findings: [{ ...validReview.findings[0], reference: "/mock_response/nonexistent" }],
  }, ["lookup_order"], references), /invalid contract reference/);
  assert.throws(() => parseRegressionContractReview({
    ...validReview,
    findings: [{ ...validReview.findings[0], toolName: "other_tool" }],
  }, ["lookup_order"], references), /selected tool/);
  assert.throws(() => parseRegressionContractReview({
    ...validReview,
    findings: [{ ...validReview.findings[0], severity: "critical" }],
  }, ["lookup_order"], references), /selected tool/);
  assert.throws(() => parseRegressionContractReview({
    ...validReview,
    findings: Array.from({ length: 9 }, () => validReview.findings[0]),
  }, ["lookup_order"], references), /supported size/);
});
