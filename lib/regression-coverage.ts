import { parseScenarios, resolveScenario } from "./scenarios.ts";
import { validateSchemaDefinition } from "./validators.ts";

export interface CoverageTool {
  id: string;
  name: string;
  json_schema: unknown;
  scenarios: unknown;
}

export interface CoverageRun {
  trace: unknown;
}

export interface RegressionCoverage {
  covered: number;
  total: number;
  percentage: number;
  observedCalls: number;
  invalidTraces: number;
  invalidToolConfigurations: number;
  gaps: Array<{
    id: string;
    toolId: string;
    toolName: string;
    kind: "field" | "enum" | "scenario" | "sequence";
    target: string;
  }>;
  tools: Array<{
    id: string;
    name: string;
    fields: { covered: number; total: number };
    enumValues: { covered: number; total: number };
    scenarios: { covered: number; total: number };
  }>;
}

export function prioritizeRegressionCoverageGaps(
  gaps: RegressionCoverage["gaps"],
): Array<{ toolName: string; target: string }> {
  const priority = { sequence: 0, scenario: 1, enum: 2, field: 3 } as const;
  return [...gaps]
    .sort((left, right) => priority[left.kind] - priority[right.kind])
    .slice(0, 12)
    .map((gap) => ({
      toolName: gap.toolName.slice(0, 80),
      target: gap.target.slice(0, 200),
    }));
}

interface CoverageUnit {
  id: string;
  kind: "field" | "enum" | "scenario" | "sequence";
  toolId: string;
  path?: string;
  value?: unknown;
  target: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readPath(value: unknown, path: string): { exists: boolean; value?: unknown } {
  let candidates = [value];
  for (const segment of path.split(".")) {
    candidates = candidates.flatMap((current) => {
      if (segment === "[]") return Array.isArray(current) ? current : [];
      return isRecord(current) && Object.hasOwn(current, segment) ? [current[segment]] : [];
    });
    if (candidates.length === 0) return { exists: false };
  }
  return { exists: true, value: candidates.length === 1 ? candidates[0] : candidates };
}

function sameJson(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function addSchemaUnits(
  schema: unknown,
  toolId: string,
  path: string,
  units: CoverageUnit[],
  depth = 0,
) {
  if (!isRecord(schema) || depth > 12) return;
  if (path) {
    units.push({
      id: `${toolId}:field:${path}`,
      kind: "field",
      toolId,
      path,
      target: `Exercise argument ${path}`,
    });
  }
  if (Array.isArray(schema.enum)) {
    for (const value of schema.enum) {
      units.push({
        id: `${toolId}:enum:${path}:${stableJson(value)}`,
        kind: "enum",
        toolId,
        path,
        value,
        target: `Exercise ${path} = ${JSON.stringify(value)}`,
      });
    }
  }
  if (isRecord(schema.properties)) {
    for (const [name, child] of Object.entries(schema.properties)) {
      addSchemaUnits(child, toolId, path ? `${path}.${name}` : name, units, depth + 1);
    }
  }
  if (schema.items) addSchemaUnits(schema.items, toolId, path ? `${path}.[]` : "[]", units, depth + 1);
}

export function analyzeRegressionCoverage(tools: CoverageTool[], runs: CoverageRun[]): RegressionCoverage {
  const units: CoverageUnit[] = [];
  const toolUnits = new Map<string, CoverageUnit[]>();
  const scenariosByTool = new Map<string, ReturnType<typeof parseScenarios>>();
  let invalidToolConfigurations = 0;

  for (const tool of tools) {
    const start = units.length;
    addSchemaUnits(tool.json_schema, tool.id, "", units);
    try {
      const scenarios = parseScenarios(tool.scenarios);
      if (scenarios.some((scenario) => validateSchemaDefinition(scenario.match))) {
        throw new Error("A scenario matcher has an invalid JSON Schema.");
      }
      scenariosByTool.set(tool.id, scenarios);
      scenarios.forEach((scenario, index) => {
        const id = `${tool.id}:scenario:${index}:${scenario.name}`;
        units.push({
          id,
          kind: "scenario",
          toolId: tool.id,
          target: `Trigger scenario "${scenario.name}"`,
        });
        scenario.responses?.forEach((_, step) => {
          units.push({
            id: `${id}:step:${step + 1}`,
            kind: "sequence",
            toolId: tool.id,
            target: `Reach response step ${step + 1} in scenario "${scenario.name}"`,
          });
        });
      });
    } catch {
      invalidToolConfigurations += 1;
    }
    toolUnits.set(tool.id, units.slice(start));
  }

  const covered = new Set<string>();
  let observedCalls = 0;
  let invalidTraces = 0;
  for (const run of runs) {
    if (run.trace === null) continue;
    if (!isRecord(run.trace) || !Array.isArray(run.trace.calls)) {
      invalidTraces += 1;
      continue;
    }
    let traceValid = true;
    for (const call of run.trace.calls) {
      if (
        !isRecord(call) ||
        typeof call.toolId !== "string" ||
        typeof call.arguments !== "string" ||
        typeof call.response !== "string" ||
        typeof call.status !== "number"
      ) {
        traceValid = false;
        break;
      }
    }
    if (!traceValid) {
      invalidTraces += 1;
      continue;
    }

    for (const call of run.trace.calls) {
      const definition = tools.find((tool) => tool.id === call.toolId);
      if (!definition || call.status < 200 || call.status >= 300) continue;
      let args: unknown;
      let response: unknown;
      try {
        args = JSON.parse(call.arguments);
        response = JSON.parse(call.response);
      } catch {
        continue;
      }
      observedCalls += 1;
      for (const unit of toolUnits.get(definition.id) ?? []) {
        if (unit.kind === "field") {
          if (unit.path && readPath(args, unit.path).exists) covered.add(unit.id);
        } else if (unit.kind === "enum") {
          const actual = unit.path ? readPath(args, unit.path) : { exists: false };
          const valueMatches = unit.path?.includes("[]") && Array.isArray(actual.value)
            ? actual.value.some((value) => sameJson(value, unit.value))
            : sameJson(actual.value, unit.value);
          if (actual.exists && valueMatches) covered.add(unit.id);
        }
      }

      const scenarios = scenariosByTool.get(definition.id) ?? [];
      const matched = resolveScenario(scenarios, args);
      if (!matched) continue;
      const scenarioIndex = scenarios.indexOf(matched);
      const scenarioUnit = (toolUnits.get(definition.id) ?? []).find(
        (unit) => unit.kind === "scenario" && unit.id.startsWith(`${definition.id}:scenario:${scenarioIndex}:`),
      );
      if (scenarioUnit) covered.add(scenarioUnit.id);
      if (matched.responses) {
        const responseIndex = matched.responses.findIndex((candidate) => sameJson(candidate, response));
        if (responseIndex >= 0) {
          const sequenceUnit = (toolUnits.get(definition.id) ?? []).find(
            (unit) => unit.id === `${scenarioUnit?.id}:step:${responseIndex + 1}`,
          );
          if (sequenceUnit) covered.add(sequenceUnit.id);
        }
      }
    }
  }

  const perTool = tools.map((tool) => {
    const scoped = toolUnits.get(tool.id) ?? [];
    const count = (kind: CoverageUnit["kind"]) => {
      const selected = scoped.filter((unit) => unit.kind === kind);
      return { covered: selected.filter((unit) => covered.has(unit.id)).length, total: selected.length };
    };
    const scenarios = count("scenario");
    const sequenceSteps = count("sequence");
    return {
      id: tool.id,
      name: tool.name,
      fields: count("field"),
      enumValues: count("enum"),
      scenarios: { covered: scenarios.covered + sequenceSteps.covered, total: scenarios.total + sequenceSteps.total },
    };
  });
  const total = units.length;
  const coveredCount = covered.size;
  return {
    covered: coveredCount,
    total,
    percentage: total === 0 ? 0 : Math.round((coveredCount / total) * 100),
    observedCalls,
    invalidTraces,
    invalidToolConfigurations,
    gaps: units
      .filter((unit) => !covered.has(unit.id))
      .flatMap((unit) => {
        const tool = tools.find((candidate) => candidate.id === unit.toolId);
        return tool
          ? [{ id: unit.id, toolId: unit.toolId, toolName: tool.name, kind: unit.kind, target: unit.target }]
          : [];
      }),
    tools: perTool,
  };
}
