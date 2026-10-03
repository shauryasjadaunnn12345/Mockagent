import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateFinalAnswer,
  parseFinalAnswerAssertions,
} from "./final-answer-assertions.ts";

const sequenceAssertion = {
  name: "Refund flow",
  type: "tool_sequence",
  tools: ["lookup_order", "check_refund_eligibility", "issue_refund"],
};

describe("tool_sequence assertions", () => {
  it("passes when the expected tools are called in order", () => {
    const assertions = parseFinalAnswerAssertions([sequenceAssertion]);
    const [result] = evaluateFinalAnswer(assertions, "Refund complete.", sequenceAssertion.tools);

    assert.equal(result.passed, true);
    assert.equal(result.detail, "The expected tools were called in the expected order.");
  });

  it("fails when a different valid tool is called", () => {
    const assertions = parseFinalAnswerAssertions([sequenceAssertion]);
    const [result] = evaluateFinalAnswer(assertions, "Refund complete.", [
      "lookup_order",
      "get_shipping_status",
      "issue_refund",
    ]);

    assert.equal(result.passed, false);
    assert.match(result.detail, /step 2.*check_refund_eligibility.*get_shipping_status/);
  });

  it("fails when a call is missing", () => {
    const assertions = parseFinalAnswerAssertions([sequenceAssertion]);
    const [result] = evaluateFinalAnswer(assertions, "", [
      "lookup_order",
      "check_refund_eligibility",
    ]);

    assert.equal(result.passed, false);
    assert.match(result.detail, /expected 3 calls, received 2.*issue_refund.*no call/i);
  });

  it("fails when there is an extra call", () => {
    const assertions = parseFinalAnswerAssertions([sequenceAssertion]);
    const [result] = evaluateFinalAnswer(assertions, "", [
      ...sequenceAssertion.tools,
      "send_followup_email",
    ]);

    assert.equal(result.passed, false);
    assert.match(result.detail, /expected 3 calls, received 4.*no call.*send_followup_email/i);
  });

  it("fails when the expected tools are reordered", () => {
    const assertions = parseFinalAnswerAssertions([sequenceAssertion]);
    const [result] = evaluateFinalAnswer(assertions, "", [
      "lookup_order",
      "issue_refund",
      "check_refund_eligibility",
    ]);

    assert.equal(result.passed, false);
    assert.match(result.detail, /step 2.*check_refund_eligibility.*issue_refund/);
  });

  it("rejects empty, oversized, or blank tool lists", () => {
    assert.throws(
      () => parseFinalAnswerAssertions([{ ...sequenceAssertion, tools: [] }]),
      /1 to 50 non-empty tool names/
    );
    assert.throws(
      () => parseFinalAnswerAssertions([{ ...sequenceAssertion, tools: Array(51).fill("tool") }]),
      /1 to 50 non-empty tool names/
    );
    assert.throws(
      () => parseFinalAnswerAssertions([{ ...sequenceAssertion, tools: ["lookup_order", " "] }]),
      /1 to 50 non-empty tool names/
    );
  });
});
