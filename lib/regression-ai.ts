import {
  parseRegressionTestCases,
  type RegressionTestCase,
} from "./regression-suites.ts";

export interface RegressionFailureFinding {
  checkName: string;
  explanation: string;
  suggestedAction: string;
}

export interface RegressionFailureExplanation {
  summary: string;
  findings: RegressionFailureFinding[];
}

export interface RegressionContractFinding {
  toolName: string;
  severity: "high" | "medium" | "low";
  area: "arguments" | "scenarios" | "responses";
  reference: string;
  risk: string;
  testPrompt: string;
}

export interface RegressionContractReview {
  summary: string;
  findings: RegressionContractFinding[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function collectRegressionContractReferences(
  tools: Array<{
    name: string;
    json_schema: unknown;
    mock_response: unknown;
    scenarios: unknown;
  }>,
): Record<string, string[]> {
  const references: Record<string, string[]> = {};
  for (const tool of tools) {
    const toolReferences: string[] = [];
    const visit = (value: unknown, path: string, depth: number) => {
      if (depth > 12 || toolReferences.length >= 1000) return;
      toolReferences.push(path);
      if (Array.isArray(value)) {
        value.forEach((item, index) => visit(item, `${path}/${index}`, depth + 1));
      } else if (isRecord(value)) {
        for (const [key, child] of Object.entries(value)) {
          visit(child, `${path}/${key.replaceAll("~", "~0").replaceAll("/", "~1")}`, depth + 1);
        }
      }
    };
    visit(tool.json_schema, "/json_schema", 0);
    visit(tool.mock_response, "/mock_response", 0);
    visit(tool.scenarios, "/scenarios", 0);
    references[tool.name] = toolReferences;
  }
  return references;
}

export function parseGeneratedRegressionTestCases(value: unknown): RegressionTestCase[] {
  if (!isRecord(value) || !Array.isArray(value.test_cases)) {
    throw new Error("Generated test cases must be returned in a test_cases array.");
  }
  if (value.test_cases.length < 1 || value.test_cases.length > 6) {
    throw new Error("Generate between 1 and 6 regression test cases.");
  }
  return parseRegressionTestCases(value.test_cases);
}

export function parseRegressionFailureExplanation(
  value: unknown,
  failedCheckNames: string[]
): RegressionFailureExplanation {
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.findings)) {
    throw new Error("Failure explanation has an invalid response shape.");
  }
  const summary = value.summary.trim();
  if (!summary || summary.length > 1200 || value.findings.length < 1 || value.findings.length > 5) {
    throw new Error("Failure explanation exceeds the supported size.");
  }
  const findings = value.findings.map((item): RegressionFailureFinding => {
    if (
      !isRecord(item) ||
      typeof item.checkName !== "string" ||
      !failedCheckNames.includes(item.checkName) ||
      typeof item.explanation !== "string" ||
      typeof item.suggestedAction !== "string"
    ) {
      throw new Error("Failure explanation must reference an actual failed check.");
    }
    const explanation = item.explanation.trim();
    const suggestedAction = item.suggestedAction.trim();
    if (
      !explanation ||
      explanation.length > 1000 ||
      !suggestedAction ||
      suggestedAction.length > 500
    ) {
      throw new Error("Failure explanation contains an empty or oversized finding.");
    }
    return { checkName: item.checkName, explanation, suggestedAction };
  });
  return { summary, findings };
}

export function parseRegressionContractReview(
  value: unknown,
  toolNames: string[],
  validReferences?: Record<string, string[]>,
): RegressionContractReview {
  if (!isRecord(value) || typeof value.summary !== "string" || !Array.isArray(value.findings)) {
    throw new Error("Contract review has an invalid response shape.");
  }
  const summary = value.summary.trim();
  if (!summary || summary.length > 1200 || value.findings.length > 8) {
    throw new Error("Contract review exceeds the supported size.");
  }
  const findings = value.findings.map((item): RegressionContractFinding => {
    if (
      !isRecord(item) ||
      typeof item.toolName !== "string" ||
      !toolNames.includes(item.toolName) ||
      (item.severity !== "high" && item.severity !== "medium" && item.severity !== "low") ||
      (item.area !== "arguments" && item.area !== "scenarios" && item.area !== "responses") ||
      typeof item.reference !== "string" ||
      typeof item.risk !== "string" ||
      typeof item.testPrompt !== "string"
    ) {
      throw new Error("Contract review findings must reference a selected tool and valid contract area.");
    }
    const reference = item.reference.trim();
    const risk = item.risk.trim();
    const testPrompt = item.testPrompt.trim();
    const expectedPrefix = item.area === "arguments"
      ? "/json_schema"
      : item.area === "scenarios"
        ? "/scenarios"
        : "/mock_response";
    if (
      !reference.startsWith(`${expectedPrefix}/`) ||
      reference.length > 300 ||
      (validReferences !== undefined && !validReferences[item.toolName]?.includes(reference)) ||
      !risk || risk.length > 800 ||
      !testPrompt || testPrompt.length > 1000
    ) {
      throw new Error("Contract review contains an invalid contract reference or oversized finding details.");
    }
    return {
      toolName: item.toolName,
      severity: item.severity,
      area: item.area,
      reference,
      risk,
      testPrompt,
    };
  });
  return { summary, findings };
}
