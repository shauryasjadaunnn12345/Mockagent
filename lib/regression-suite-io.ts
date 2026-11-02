import { parseRegressionSuiteInput } from "./regression-suites.ts";

export const REGRESSION_SUITE_BUNDLE_FORMAT = "mockagent-regression-suites";
export const MAX_REGRESSION_SUITE_BUNDLE_BYTES = 10_000_000;
export const MAX_REGRESSION_SUITES_PER_BUNDLE = 50;

export interface RegressionSuiteExport {
  name: string;
  prompt: string;
  testCases: unknown;
  toolNames: string[];
  expectedToolNames: string[] | null;
  requiredAnswerText: string[];
  responseAssertions: unknown;
  semanticCriteria: string | null;
}

export interface RegressionSuiteBundle {
  format: typeof REGRESSION_SUITE_BUNDLE_FORMAT;
  version: 1;
  suites: RegressionSuiteExport[];
}

export function createRegressionSuiteBundle(suites: RegressionSuiteExport[]): RegressionSuiteBundle {
  return {
    format: REGRESSION_SUITE_BUNDLE_FORMAT,
    version: 1,
    suites: suites.map((suite) => ({
      name: suite.name,
      prompt: suite.prompt,
      testCases: suite.testCases,
      toolNames: [...suite.toolNames],
      expectedToolNames: suite.expectedToolNames ? [...suite.expectedToolNames] : null,
      requiredAnswerText: [...suite.requiredAnswerText],
      responseAssertions: suite.responseAssertions,
      semanticCriteria: suite.semanticCriteria,
    })),
  };
}

export function parseRegressionSuiteBundle(text: string) {
  if (new TextEncoder().encode(text).byteLength > MAX_REGRESSION_SUITE_BUNDLE_BYTES) {
    throw new Error("Import file must be 1 MB or smaller.");
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Import file must contain valid JSON.");
  }
  if (!isRecord(value) || value.format !== REGRESSION_SUITE_BUNDLE_FORMAT || value.version !== 1) {
    throw new Error("This is not a supported MockAgent regression suite export.");
  }
  if (!Array.isArray(value.suites) || value.suites.length < 1 || value.suites.length > MAX_REGRESSION_SUITES_PER_BUNDLE) {
    throw new Error(`Import must contain between 1 and ${MAX_REGRESSION_SUITES_PER_BUNDLE} suites.`);
  }
  return value.suites.map((suite, index) => {
    try {
      if (!isRecord(suite)) throw new Error("Suite must be an object.");
      if (!Array.isArray(suite.toolNames) || !suite.toolNames.every((name) => typeof name === "string")) {
        throw new Error("Tool references are invalid.");
      }
      if (
        suite.expectedToolNames !== null &&
        (!Array.isArray(suite.expectedToolNames) || !suite.expectedToolNames.every((name) => typeof name === "string"))
      ) {
        throw new Error("Expected tool references are invalid.");
      }
      const parsed = parseRegressionSuiteInput({
        name: suite.name,
        prompt: suite.prompt,
        testCases: suite.testCases,
        toolIds: suite.toolNames,
        expectedToolIds: suite.expectedToolNames,
        requiredAnswerText: suite.requiredAnswerText,
        responseAssertions: suite.responseAssertions,
        semanticCriteria: suite.semanticCriteria,
      });
      return {
        suite: parsed,
        toolNames: [...parsed.toolIds],
        expectedToolNames: parsed.expectedToolIds ? [...parsed.expectedToolIds] : null,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Suite is invalid.";
      throw new Error(`Suite ${index + 1}: ${message}`);
    }
  });
}

export function mapImportedRegressionSuiteTools(
  imported: ReturnType<typeof parseRegressionSuiteBundle>[number],
  toolMappings: Record<string, string>,
) {
  const toolNames = [
    ...imported.toolNames,
    ...(imported.expectedToolNames ?? []),
    ...imported.suite.responseAssertions.map((assertion) => assertion.toolId),
  ];
  const missingName = toolNames.find((name) => typeof toolMappings[name] !== "string" || !toolMappings[name].trim());
  if (missingName) throw new Error(`Map exported tool "${missingName}" to an active workspace tool.`);
  const mapName = (name: string) => toolMappings[name];
  return {
    ...imported.suite,
    toolIds: imported.toolNames.map(mapName),
    expectedToolIds: imported.expectedToolNames?.map(mapName) ?? null,
    responseAssertions: imported.suite.responseAssertions.map((assertion) => ({
      ...assertion,
      toolId: mapName(assertion.toolId),
    })),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
