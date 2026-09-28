import { validateAgainstSchema } from "@/lib/validators";

export interface MockScenario {
  name: string;
  match: Record<string, unknown>;
  response: Record<string, unknown>;
}

export function parseScenarios(value: unknown): MockScenario[] {
  if (!Array.isArray(value)) {
    throw new Error("Scenarios must be a JSON array.");
  }

  return value.map((scenario, index) => {
    if (!scenario || typeof scenario !== "object" || Array.isArray(scenario)) {
      throw new Error(`Scenario ${index + 1} must be an object.`);
    }

    const candidate = scenario as Record<string, unknown>;
    if (typeof candidate.name !== "string" || !candidate.name.trim()) {
      throw new Error(`Scenario ${index + 1} needs a name.`);
    }
    if (!isJsonObject(candidate.match)) {
      throw new Error(`Scenario ${index + 1} match must be a JSON Schema object.`);
    }
    if (!isJsonObject(candidate.response)) {
      throw new Error(`Scenario ${index + 1} response must be a JSON object.`);
    }

    return {
      name: candidate.name.trim(),
      match: candidate.match,
      response: candidate.response,
    };
  });
}

export function resolveScenario(
  scenarios: MockScenario[],
  payload: unknown
): MockScenario | null {
  return (
    scenarios.find((scenario) => {
      const { valid } = validateAgainstSchema(scenario.match, payload);
      return valid;
    }) ?? null
  );
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}