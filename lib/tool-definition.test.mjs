import assert from "node:assert/strict";
import test from "node:test";
import { parseToolConfiguration } from "./tool-definition.ts";

const validInput = {
  name: " lookup_order ",
  description: "Find an order",
  jsonSchema: '{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}',
  mockResponse: '{"status":"found"}',
  scenarios: "[]",
  finalAnswerAssertions: "[]",
  semanticCriteria: "",
};

test("parses and normalizes a valid tool configuration", () => {
  assert.deepEqual(parseToolConfiguration(validInput), {
    name: "lookup_order",
    description: "Find an order",
    json_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
    mock_response: { status: "found" },
    scenarios: [],
    final_answer_assertions: [],
    semantic_criteria: null,
  });
});

test("rejects malformed or non-object JSON definitions", () => {
  assert.throws(
    () => parseToolConfiguration({ ...validInput, jsonSchema: "{" }),
    /Expected JSON Schema is not valid JSON/,
  );
  assert.throws(
    () => parseToolConfiguration({ ...validInput, mockResponse: "[]" }),
    /Mock response body must be a JSON object/,
  );
});

test("rejects invalid schemas and oversized fields", () => {
  assert.throws(
    () => parseToolConfiguration({ ...validInput, jsonSchema: '{"type":"invalid"}' }),
    /Expected JSON Schema is invalid/,
  );
  assert.throws(
    () => parseToolConfiguration({ ...validInput, name: "x".repeat(101) }),
    /Tool name must be at most 100 characters/,
  );
});
