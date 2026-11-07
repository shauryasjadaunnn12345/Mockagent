import type { ImportedTool } from "./tool-import.ts";

export interface ExistingToolContract {
  id: string;
  name: string;
  description: string | null;
  json_schema: unknown;
}

export type ToolDriftFinding =
  | {
      kind: "missing_mock" | "missing_spec";
      toolName: string;
      path: string;
    }
  | {
      kind: "schema" | "description";
      toolName: string;
      path: string;
      expected: unknown;
      actual: unknown;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function equalJson(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => equalJson(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) =>
        key === rightKeys[index] && equalJson(left[key], right[key])
      );
  }
  return false;
}

function escapePointerSegment(value: string): string {
  return value.replace(/~/g, "~0").replace(/\//g, "~1");
}

function diffSchema(
  toolName: string,
  expected: unknown,
  actual: unknown,
  path: string,
  findings: ToolDriftFinding[],
): void {
  if (equalJson(expected, actual)) return;
  if (isRecord(expected) && isRecord(actual)) {
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    for (const key of keys) {
      const childPath = `${path}/${escapePointerSegment(key)}`;
      if (!Object.hasOwn(expected, key)) {
        findings.push({
          kind: "schema",
          toolName,
          path: childPath,
          expected: undefined,
          actual: actual[key],
        });
      } else if (!Object.hasOwn(actual, key)) {
        findings.push({
          kind: "schema",
          toolName,
          path: childPath,
          expected: expected[key],
          actual: undefined,
        });
      } else {
        diffSchema(toolName, expected[key], actual[key], childPath, findings);
      }
      if (findings.length >= 100) return;
    }
    return;
  }
  findings.push({ kind: "schema", toolName, path, expected, actual });
}

export function compareToolContracts(
  existingTools: ExistingToolContract[],
  specTools: ImportedTool[],
): ToolDriftFinding[] {
  const existingByName = new Map(existingTools.map((tool) => [tool.name, tool]));
  const specByName = new Map(specTools.map((tool) => [tool.name, tool]));
  const findings: ToolDriftFinding[] = [];

  for (const existing of existingTools) {
    const specification = specByName.get(existing.name);
    if (!specification) {
      findings.push({ kind: "missing_spec", toolName: existing.name, path: "/" });
      continue;
    }
    diffSchema(
      existing.name,
      specification.jsonSchema,
      existing.json_schema,
      "",
      findings,
    );
    if (existing.description !== specification.description) {
      findings.push({
        kind: "description",
        toolName: existing.name,
        path: "/description",
        expected: specification.description,
        actual: existing.description,
      });
    }
  }

  for (const specification of specTools) {
    if (!existingByName.has(specification.name)) {
      findings.push({ kind: "missing_mock", toolName: specification.name, path: "/" });
    }
  }
  return findings;
}
