import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  evaluateCallGuards,
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

  describe("call safety guards", () => {
    it("allows confirmed calls and values within the configured maximum", () => {
      const assertions = parseFinalAnswerAssertions([
        {
          name: "Refund confirmation",
          type: "call_guard",
          path: "/confirmed",
          operator: "equals",
          value: true,
          message: "Refunds require confirmation.",
        },
        {
          name: "Refund amount ceiling",
          type: "call_guard",
          path: "/amount",
          operator: "lte",
          value: 500,
          message: "Refund amount exceeds the configured limit.",
        },
      ]);
      assert.deepEqual(
        evaluateCallGuards(assertions, { confirmed: true, amount: 450 }).map((result) => result.passed),
        [true, true],
      );
      assert.deepEqual(evaluateFinalAnswer(assertions, "done"), []);
    });

    it("blocks unconfirmed and over-limit calls with clear policy violations", () => {
      const assertions = parseFinalAnswerAssertions([
        {
          name: "Refund confirmation",
          type: "call_guard",
          path: "/confirmed",
          operator: "equals",
          value: true,
          message: "Refunds require confirmation.",
        },
        {
          name: "Refund amount ceiling",
          type: "call_guard",
          path: "/amount",
          operator: "lte",
          value: 500,
          message: "Refund amount exceeds the configured limit.",
        },
      ]);
      assert.deepEqual(
        evaluateCallGuards(assertions, { confirmed: false, amount: 501 }).map(({ passed, message }) => ({ passed, message })),
        [
          { passed: false, message: "Refunds require confirmation." },
          { passed: false, message: "Refund amount exceeds the configured limit." },
        ],
      );
    });

    it("rejects malformed or non-numeric call guards", () => {
      assert.throws(
        () => parseFinalAnswerAssertions([{
          name: "Bad pointer",
          type: "call_guard",
          path: "amount",
          operator: "lte",
          value: 1,
          message: "Must not happen.",
        }]),
        /valid JSON Pointer/,
      );
      assert.throws(
        () => parseFinalAnswerAssertions([{
          name: "Bad amount",
          type: "call_guard",
          path: "/amount",
          operator: "lte",
          value: "500",
          message: "Must not happen.",
        }]),
        /finite number/,
      );
    });
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
