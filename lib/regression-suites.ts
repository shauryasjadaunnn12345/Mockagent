import type { Json } from "@/types/database";

export const MAX_REGRESSION_SUITE_NAME_LENGTH = 80;
export const MAX_REGRESSION_EXPECTED_PHRASES = 20;
export const MAX_REGRESSION_PHRASE_LENGTH = 200;
export const MAX_REGRESSION_RESPONSE_ASSERTIONS = 20;
export const MAX_REGRESSION_TEST_CASES = 20;
export const MAX_REGRESSION_TEST_CASE_PROMPT_LENGTH = 5000;
export const MAX_REGRESSION_TEST_CASES_TOTAL_LENGTH = 20000;

export type ResponseAssertionOperator = "equals" | "contains" | "exists" | "greater_than" | "less_than";

export interface RegressionResponseAssertion {
  toolId: string;
  path: string;
  operator: ResponseAssertionOperator;
  expected?: Json;
}

export function isResponseAssertionOperator(value: string): value is ResponseAssertionOperator {
  return ["equals", "contains", "exists", "greater_than", "less_than"].includes(value);
}

export interface RegressionSuiteInput {
  name: string;
  prompt: string;
  testCases: RegressionTestCase[];
  toolIds: string[];
  expectedToolIds: string[] | null;
  requiredAnswerText: string[];
  responseAssertions: RegressionResponseAssertion[];
}

export interface RegressionTestCase {
  name: string;
  prompt: string;
}

export interface RegressionCheck {
  name: string;
  passed: boolean;
  expected: string | string[];
  actual: string | string[];
}

export interface RegressionEvaluation {
  passed: boolean;
  checks: RegressionCheck[];
}

export function parseRegressionTestCases(
  value: unknown,
  fallbackPrompt = ""
): RegressionTestCase[] {
  const rawCases =
    value === undefined || value === null || (Array.isArray(value) && value.length === 0)
      ? [{ name: "Case 1", prompt: fallbackPrompt }]
      : value;
  if (!Array.isArray(rawCases) || rawCases.length === 0 || rawCases.length > MAX_REGRESSION_TEST_CASES) {
    throw new Error(`Add between 1 and ${MAX_REGRESSION_TEST_CASES} test cases.`);
  }

  const names = new Set<string>();
  let totalPromptLength = 0;
  const testCases = rawCases.map((item, index): RegressionTestCase => {
    if (!isRecord(item)) throw new Error(`Test case ${index + 1} must be an object.`);
    const name = typeof item.name === "string" ? item.name.trim() : "";
    const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
    if (!name || name.length > MAX_REGRESSION_SUITE_NAME_LENGTH) {
      throw new Error(`Test case ${index + 1} needs a name of at most ${MAX_REGRESSION_SUITE_NAME_LENGTH} characters.`);
    }
    if (!prompt || prompt.length > MAX_REGRESSION_TEST_CASE_PROMPT_LENGTH) {
      throw new Error(`Test case ${index + 1} needs a prompt of at most 5,000 characters.`);
    }
    const normalizedName = name.toLocaleLowerCase();
    if (names.has(normalizedName)) throw new Error(`Test case name "${name}" is duplicated.`);
    names.add(normalizedName);
    totalPromptLength += prompt.length;
    if (totalPromptLength > MAX_REGRESSION_TEST_CASES_TOTAL_LENGTH) {
      throw new Error("Combined test case prompts must be at most 20,000 characters.");
    }
    return { name, prompt };
  });
  return testCases;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isSafeJsonValue(value: unknown, depth = 0, budget = { remaining: 500 }): value is Json {
  budget.remaining -= 1;
  if (budget.remaining < 0) return false;
  if (depth > 8) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "string") return value.length <= 1000;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => isSafeJsonValue(item, depth + 1, budget));
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  return entries.length <= 100 &&
    entries.every(([key, item]) =>
      key !== "__proto__" && key !== "constructor" && key !== "prototype" &&
      key.length <= 200 && isSafeJsonValue(item, depth + 1, budget)
    );
}

function readPath(value: unknown, path: string): { exists: boolean; value?: unknown } {
  const segments = path.split(".");
  let current = value;
  for (const segment of segments) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      const index = Number(segment);
      if (index >= current.length) return { exists: false };
      current = current[index];
    } else if (isRecord(current) && Object.hasOwn(current, segment)) {
      current = current[segment];
    } else {
      return { exists: false };
    }
  }
  return { exists: true, value: current };
}

function jsonEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => jsonEqual(item, right[index]));
  }
  if (isRecord(left) && isRecord(right)) {
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length &&
      leftKeys.every((key, index) => key === rightKeys[index] && jsonEqual(left[key], right[key]));
  }
  return false;
}

export function parseRegressionResponseAssertions(
  value: unknown,
  toolIds: string[]
): RegressionResponseAssertion[] {
  const rawAssertions = value ?? [];
  if (!Array.isArray(rawAssertions) || rawAssertions.length > MAX_REGRESSION_RESPONSE_ASSERTIONS) {
    throw new Error(`Add at most ${MAX_REGRESSION_RESPONSE_ASSERTIONS} tool-response assertions.`);
  }
  return rawAssertions.map((assertion): RegressionResponseAssertion => {
    if (!isRecord(assertion)) throw new Error("Tool-response assertion must be an object.");
    const { toolId, path, operator, expected } = assertion;
    if (typeof toolId !== "string" || !toolIds.includes(toolId)) {
      throw new Error("Tool-response assertions must reference a selected tool.");
    }
    if (
      typeof path !== "string" ||
      path.length > 200 ||
      !/^[a-zA-Z0-9_$-]+(?:\.[a-zA-Z0-9_$-]+)*$/.test(path) ||
      path.split(".").some((segment) => ["__proto__", "constructor", "prototype"].includes(segment))
    ) {
      throw new Error("Assertion path must be a safe dot-separated JSON path, such as data.status or items.0.id.");
    }
    if (typeof operator !== "string" || !isResponseAssertionOperator(operator)) {
      throw new Error("Choose a supported tool-response assertion operator.");
    }
    let expectedValue: Json | undefined;
    if (operator !== "exists") {
      if (!isSafeJsonValue(expected)) {
        throw new Error("Assertion expected value must be valid JSON.");
      }
      if (JSON.stringify(expected).length > 4000) {
        throw new Error("Assertion expected value must be at most 4,000 characters.");
      }
      expectedValue = expected;
    }
    if ((operator === "greater_than" || operator === "less_than") && typeof expectedValue !== "number") {
      throw new Error("Numeric assertions require a JSON number as the expected value.");
    }
    return {
      toolId,
      path,
      operator,
      ...(operator === "exists" ? {} : { expected: expectedValue }),
    };
  });
}

export function parseRegressionSuiteInput(value: unknown): RegressionSuiteInput {
  if (!isRecord(value)) throw new Error("Regression test must be an object.");

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) throw new Error("Test name is required.");
  if (name.length > MAX_REGRESSION_SUITE_NAME_LENGTH) {
    throw new Error(`Test name must be at most ${MAX_REGRESSION_SUITE_NAME_LENGTH} characters.`);
  }

  const testCases = parseRegressionTestCases(
    value.testCases,
    typeof value.prompt === "string" ? value.prompt : ""
  );
  const prompt = testCases[0].prompt;

  const toolIds = value.toolIds;
  if (
    !Array.isArray(toolIds) ||
    toolIds.length === 0 ||
    toolIds.length > 8 ||
    !toolIds.every((toolId) => typeof toolId === "string" && toolId.length > 0 && toolId.length <= 64)
  ) {
    throw new Error("Select between 1 and 8 valid tools.");
  }
  if (new Set(toolIds).size !== toolIds.length) {
    throw new Error("Selected tools must be unique.");
  }

  let expectedToolIds: string[] | null = null;
  if (value.expectedToolIds !== null && value.expectedToolIds !== undefined) {
    if (
      !Array.isArray(value.expectedToolIds) ||
      !value.expectedToolIds.every(
        (toolId) => typeof toolId === "string" && toolId.length > 0 && toolId.length <= 64
      )
    ) {
      throw new Error("Expected tool sequence is invalid.");
    }
    expectedToolIds = value.expectedToolIds;
    if (new Set(expectedToolIds).size !== expectedToolIds.length) {
      throw new Error("Expected tool sequence cannot repeat a tool.");
    }
    if (!expectedToolIds.every((toolId) => toolIds.includes(toolId))) {
      throw new Error("Expected tool sequence must use only selected tools.");
    }
  }

  const rawPhrases = value.requiredAnswerText ?? [];
  if (
    !Array.isArray(rawPhrases) ||
    rawPhrases.length > MAX_REGRESSION_EXPECTED_PHRASES ||
    !rawPhrases.every(
      (phrase) =>
        typeof phrase === "string" &&
        phrase.trim().length > 0 &&
        phrase.trim().length <= MAX_REGRESSION_PHRASE_LENGTH
    )
  ) {
    throw new Error(
      `Add at most ${MAX_REGRESSION_EXPECTED_PHRASES} non-empty answer phrases, each at most ${MAX_REGRESSION_PHRASE_LENGTH} characters.`
    );
  }
  const requiredAnswerText = rawPhrases.map((phrase) => phrase.trim());

  const responseAssertions = parseRegressionResponseAssertions(value.responseAssertions, toolIds);

  if (expectedToolIds === null && requiredAnswerText.length === 0 && responseAssertions.length === 0) {
    throw new Error("Add a tool sequence, a tool-response assertion, or at least one required answer phrase.");
  }

  return { name, prompt, testCases, toolIds, expectedToolIds, requiredAnswerText, responseAssertions };
}

export function evaluateRegressionTest(
  expectedToolIds: string[] | null,
  requiredAnswerText: string[],
  actualToolIds: string[],
  answer: string,
  toolStatuses?: number[],
  actualCalls?: Array<{ toolId: string; toolName?: string; response: unknown }>,
  responseAssertions: RegressionResponseAssertion[] = []
): RegressionEvaluation {
  const checks: RegressionCheck[] = [];

  if (toolStatuses) {
    checks.push({
      name: "All tool calls succeeded",
      passed: toolStatuses.every((status) => status >= 200 && status < 300),
      expected: "HTTP 2xx for every tool call",
      actual: toolStatuses.map((status) => `HTTP ${status}`),
    });
  }

  if (expectedToolIds !== null) {
    checks.push({
      name: "Exact tool sequence",
      passed:
        expectedToolIds.length === actualToolIds.length &&
        expectedToolIds.every((toolId, index) => toolId === actualToolIds[index]),
      expected: expectedToolIds,
      actual: actualToolIds,
    });
  }

  for (const phrase of requiredAnswerText) {
    checks.push({
      name: `Answer contains "${phrase}"`,
      passed: answer.toLocaleLowerCase().includes(phrase.toLocaleLowerCase()),
      expected: phrase,
      actual: answer,
    });
  }

  for (const assertion of responseAssertions) {
    const matchingCall = actualCalls?.find((call) => call.toolId === assertion.toolId);
    const pathResult = matchingCall ? readPath(matchingCall.response, assertion.path) : { exists: false };
    const expectedDescription = assertion.operator === "exists"
      ? "field exists"
      : `${assertion.operator} ${JSON.stringify(assertion.expected)}`;
    const passed = (() => {
      if (assertion.operator === "exists") return pathResult.exists;
      if (!pathResult.exists) return false;
      if (assertion.operator === "equals") {
        return jsonEqual(pathResult.value, assertion.expected);
      }
      if (assertion.operator === "contains") {
        if (typeof pathResult.value === "string" && typeof assertion.expected === "string") {
          return pathResult.value.includes(assertion.expected);
        }
        return Array.isArray(pathResult.value) && pathResult.value.some(
          (item) => jsonEqual(item, assertion.expected)
        );
      }
      if (typeof pathResult.value !== "number" || typeof assertion.expected !== "number") return false;
      return assertion.operator === "greater_than"
        ? pathResult.value > assertion.expected
        : pathResult.value < assertion.expected;
    })();

    checks.push({
      name: `${matchingCall?.toolName ?? assertion.toolId} response ${assertion.path} ${assertion.operator}`,
      passed,
      expected: expectedDescription,
      actual: pathResult.exists
        ? describeAssertionValue(pathResult.value)
        : matchingCall ? "field not found" : "tool not called",
    });
  }

  function describeAssertionValue(value: unknown): string {
    const serialized = JSON.stringify(value) ?? "undefined";
    return serialized.length <= 1000 ? serialized : `${serialized.slice(0, 1000)}… [truncated]`;
  }

  return {
    passed: checks.length > 0 && checks.every((check) => check.passed),
    checks,
  };
}
