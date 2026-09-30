import { validateAgainstSchema } from "@/lib/validators";

export interface MockScenario {
  name: string;
  match: Record<string, unknown>;
  response?: Record<string, unknown>;
  responses?: Record<string, unknown>[];
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
    if (candidate.response !== undefined && !isJsonObject(candidate.response)) {
      throw new Error(`Scenario ${index + 1} response must be a JSON object.`);
    }
    if (
      candidate.responses !== undefined &&
      (!Array.isArray(candidate.responses) ||
        candidate.responses.length === 0 ||
        !candidate.responses.every(isJsonObject))
    ) {
      throw new Error(`Scenario ${index + 1} responses must be a non-empty array of JSON objects.`);
    }
    if ((candidate.response === undefined) === (candidate.responses === undefined)) {
      throw new Error(`Scenario ${index + 1} must define either response or responses.`);
    }

    return {
      name: candidate.name.trim(),
      match: candidate.match,
      ...(candidate.response === undefined
        ? { responses: candidate.responses as Record<string, unknown>[] }
        : { response: candidate.response as Record<string, unknown> }),
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

export function resolveScenarioResponse(
  scenario: MockScenario,
  step = 1
): Record<string, unknown> {
  if (scenario.responses) {
    const responseIndex = Math.min(
      Math.max(step - 1, 0),
      scenario.responses.length - 1
    );
    return scenario.responses[responseIndex];
  }
  return scenario.response ?? {};
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}