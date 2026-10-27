import { parseFinalAnswerAssertions } from "./final-answer-assertions.ts";
import { parseSemanticCriteria } from "./semantic-evaluation.ts";
import { parseScenarios } from "./scenarios.ts";
import { validateSchemaDefinition } from "./validators.ts";
import type { Json } from "@/types/database";

export interface ToolConfigurationInput {
  name: string;
  description: string;
  jsonSchema: string;
  mockResponse: string;
  scenarios: string;
  finalAnswerAssertions: string;
  semanticCriteria: string;
}

export interface ToolConfiguration {
  name: string;
  description: string | null;
  json_schema: Json;
  mock_response: Json;
  scenarios: Json;
  final_answer_assertions: Json;
  semantic_criteria: string | null;
}

function parseJsonObject(raw: string, fieldLabel: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error(`${fieldLabel} is not valid JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldLabel} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

export function parseToolConfiguration(
  input: ToolConfigurationInput
): ToolConfiguration {
  const name = input.name.trim();
  if (!name) throw new Error("Tool name is required.");
  if (name.length > 100) throw new Error("Tool name must be at most 100 characters.");

  const description = input.description.trim();
  if (description.length > 1000) {
    throw new Error("Tool description must be at most 1,000 characters.");
  }

  const jsonSchema = parseJsonObject(input.jsonSchema, "Expected JSON Schema");
  const mockResponse = parseJsonObject(input.mockResponse, "Mock response body");
  let scenarios: ReturnType<typeof parseScenarios>;
  let finalAnswerAssertions: ReturnType<typeof parseFinalAnswerAssertions>;
  let semanticCriteria: string | null;

  try {
    scenarios = parseScenarios(JSON.parse(input.scenarios));
    finalAnswerAssertions = parseFinalAnswerAssertions(JSON.parse(input.finalAnswerAssertions));
    semanticCriteria = parseSemanticCriteria(input.semanticCriteria);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Tool configuration is invalid.");
  }

  const schemaError = validateSchemaDefinition(jsonSchema);
  if (schemaError) throw new Error(`Expected JSON Schema is invalid: ${schemaError}`);
  for (const [index, scenario] of scenarios.entries()) {
    const scenarioError = validateSchemaDefinition(scenario.match);
    if (scenarioError) {
      throw new Error(`Scenario ${index + 1} has an invalid match schema: ${scenarioError}`);
    }
  }

  return {
    name,
    description: description || null,
    json_schema: jsonSchema as Json,
    mock_response: mockResponse as Json,
    scenarios: scenarios as unknown as Json,
    final_answer_assertions: finalAnswerAssertions as unknown as Json,
    semantic_criteria: semanticCriteria,
  };
}
