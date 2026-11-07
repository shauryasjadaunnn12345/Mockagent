import { validateSchemaDefinition } from "./validators.ts";
import { parseScenarios } from "./scenarios.ts";
import { parseFinalAnswerAssertions } from "./final-answer-assertions.ts";

export const MAX_RUN_TOOL_SNAPSHOT_BYTES = 256_000;

export interface RunToolSnapshot {
  id: string;
  name: string;
  description: string | null;
  json_schema: unknown;
  mock_response: unknown;
  scenarios: unknown;
  final_answer_assertions?: unknown;
  updated_at: string;
}

export interface RunToolSnapshotBundle {
  version: 1;
  tools: RunToolSnapshot[];
}

export function createRunToolSnapshotBundle(
  tools: RunToolSnapshot[],
): RunToolSnapshotBundle {
  const bundle: RunToolSnapshotBundle = {
    version: 1,
    tools: tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      json_schema: tool.json_schema,
      mock_response: tool.mock_response,
      scenarios: tool.scenarios,
      ...(tool.final_answer_assertions === undefined
        ? {}
        : { final_answer_assertions: tool.final_answer_assertions }),
      updated_at: tool.updated_at,
    })),
  };
  assertRunToolSnapshotBundle(bundle, tools.map((tool) => tool.id));
  return bundle;
}

export function assertRunToolSnapshotBundle(
  value: unknown,
  expectedToolIds: string[],
): asserts value is RunToolSnapshotBundle {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).version !== 1 ||
    !Array.isArray((value as Record<string, unknown>).tools)
  ) {
    throw new Error("Run tool configuration snapshot is invalid.");
  }

  const tools = (value as { tools: unknown[] }).tools;
  if (
    tools.length !== expectedToolIds.length ||
    new Set(tools.map((tool) =>
      tool && typeof tool === "object" && !Array.isArray(tool)
        ? (tool as Record<string, unknown>).id
        : null
    )).size !== tools.length
  ) {
    throw new Error("Run tool configuration snapshot does not match the selected tools.");
  }

  for (const [index, candidate] of tools.entries()) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new Error(`Tool snapshot ${index + 1} is invalid.`);
    }
    const tool = candidate as Record<string, unknown>;
    if (
      typeof tool.id !== "string" ||
      !expectedToolIds.includes(tool.id) ||
      typeof tool.name !== "string" ||
      !tool.name.trim() ||
      tool.name.length > 100 ||
      (tool.description !== null && typeof tool.description !== "string") ||
      typeof tool.updated_at !== "string" ||
      !Number.isFinite(Date.parse(tool.updated_at)) ||
      !tool.json_schema ||
      typeof tool.json_schema !== "object" ||
      Array.isArray(tool.json_schema) ||
      !tool.mock_response ||
      typeof tool.mock_response !== "object" ||
      Array.isArray(tool.mock_response)
    ) {
      throw new Error(`Tool snapshot ${index + 1} is missing a valid configuration.`);
    }
    const schemaError = validateSchemaDefinition(tool.json_schema as Record<string, unknown>);
    if (schemaError) throw new Error(`Tool snapshot "${tool.name}" has an invalid schema: ${schemaError}`);
    try {
      parseScenarios(tool.scenarios);
    } catch (error) {
      throw new Error(
        `Tool snapshot "${tool.name}" has invalid scenarios: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }
    if (tool.final_answer_assertions !== undefined) {
      try {
        parseFinalAnswerAssertions(tool.final_answer_assertions);
      } catch (error) {
        throw new Error(
          `Tool snapshot "${tool.name}" has invalid safety assertions: ${
            error instanceof Error ? error.message : "unknown error"
          }`,
        );
      }
    }
  }

  if (new Set(expectedToolIds).size !== expectedToolIds.length) {
    throw new Error("Selected tool IDs must be unique.");
  }
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > MAX_RUN_TOOL_SNAPSHOT_BYTES) {
    throw new Error(`Run tool configuration snapshots must be ${MAX_RUN_TOOL_SNAPSHOT_BYTES / 1000} KB or smaller.`);
  }
}

export function applyRunToolSnapshot<T extends { id: string }>(
  currentTools: T[],
  bundle: RunToolSnapshotBundle,
): Array<T & Omit<RunToolSnapshot, "id">> {
  const snapshotById = new Map(bundle.tools.map((tool) => [tool.id, tool]));
  return currentTools.map((tool) => {
    const snapshot = snapshotById.get(tool.id);
    if (!snapshot) throw new Error(`Tool "${tool.id}" is missing from the saved run snapshot.`);
    return {
      ...tool,
      name: snapshot.name,
      description: snapshot.description,
      json_schema: snapshot.json_schema,
      mock_response: snapshot.mock_response,
      scenarios: snapshot.scenarios,
      ...(snapshot.final_answer_assertions === undefined
        ? {}
        : { final_answer_assertions: snapshot.final_answer_assertions }),
      updated_at: snapshot.updated_at,
    };
  });
}
