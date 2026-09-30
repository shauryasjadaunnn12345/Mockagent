export type FinalAnswerAssertion =
  | {
      name: string;
      type: "contains";
      text: string;
      case_sensitive?: boolean;
    }
  | {
      name: string;
      type: "not_contains";
      text: string;
      case_sensitive?: boolean;
    }
  | {
      name: string;
      type: "before";
      first: string;
      then: string;
      case_sensitive?: boolean;
    };

export interface FinalAnswerAssertionResult {
  name: string;
  type: FinalAnswerAssertion["type"];
  passed: boolean;
  detail: string;
}

export function parseFinalAnswerAssertions(value: unknown): FinalAnswerAssertion[] {
  if (!Array.isArray(value)) {
    throw new Error("Final-answer assertions must be a JSON array.");
  }
  if (value.length > 30) {
    throw new Error("A tool can have at most 30 final-answer assertions.");
  }

  const names = new Set<string>();
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Assertion ${index + 1} must be an object.`);
    }
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.name !== "string" || !candidate.name.trim()) {
      throw new Error(`Assertion ${index + 1} needs a name.`);
    }
    const name = candidate.name.trim();
    if (names.has(name)) throw new Error(`Assertion name "${name}" is duplicated.`);
    names.add(name);

    if (candidate.case_sensitive !== undefined && typeof candidate.case_sensitive !== "boolean") {
      throw new Error(`Assertion ${index + 1} case_sensitive must be a boolean.`);
    }

    if (candidate.type === "contains" || candidate.type === "not_contains") {
      if (!isNonEmptyText(candidate.text)) {
        throw new Error(`Assertion ${index + 1} needs non-empty text.`);
      }
      return {
        name,
        type: candidate.type,
        text: candidate.text,
        ...(candidate.case_sensitive === undefined ? {} : { case_sensitive: candidate.case_sensitive }),
      };
    }

    if (candidate.type === "before") {
      if (!isNonEmptyText(candidate.first) || !isNonEmptyText(candidate.then)) {
        throw new Error(`Assertion ${index + 1} needs non-empty first and then text.`);
      }
      return {
        name,
        type: "before",
        first: candidate.first,
        then: candidate.then,
        ...(candidate.case_sensitive === undefined ? {} : { case_sensitive: candidate.case_sensitive }),
      };
    }

    throw new Error(`Assertion ${index + 1} has an unsupported type.`);
  });
}

export function evaluateFinalAnswer(
  assertions: FinalAnswerAssertion[],
  answer: string
): FinalAnswerAssertionResult[] {
  return assertions.map((assertion) => {
    const normalize = (value: string) =>
      assertion.case_sensitive ? value : value.toLocaleLowerCase();
    const normalizedAnswer = normalize(answer);

    if (assertion.type === "contains" || assertion.type === "not_contains") {
      const found = normalizedAnswer.includes(normalize(assertion.text));
      const passed = assertion.type === "contains" ? found : !found;
      return {
        name: assertion.name,
        type: assertion.type,
        passed,
        detail: passed
          ? assertion.type === "contains"
            ? "Required text was present."
            : "Forbidden text was absent."
          : assertion.type === "contains"
            ? `Required text was not found: ${assertion.text}`
            : `Forbidden text was found: ${assertion.text}`,
      };
    }

    const firstIndex = normalizedAnswer.indexOf(normalize(assertion.first));
    const thenIndex = normalizedAnswer.indexOf(normalize(assertion.then));
    const passed = firstIndex >= 0 && thenIndex >= 0 && firstIndex < thenIndex;
    return {
      name: assertion.name,
      type: assertion.type,
      passed,
      detail: passed
        ? "Required text appeared in the requested order."
        : `Expected "${assertion.first}" before "${assertion.then}".`,
    };
  });
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 500;
}