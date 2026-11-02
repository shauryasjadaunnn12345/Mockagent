const CONFIGURATION_FIELDS = [
  ["name", "Name"],
  ["description", "Description"],
  ["json_schema", "Argument schema"],
  ["mock_response", "Default response"],
  ["scenarios", "Scenarios"],
  ["final_answer_assertions", "Assertions"],
  ["semantic_criteria", "Semantic QA criteria"],
] as const;

export interface ToolRevisionDifference {
  key: string;
  label: string;
  previous: string;
  current: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableJson(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function formatValue(value: unknown): string {
  if (value === undefined) return "(not present)";
  const formatted = JSON.stringify(value, null, 2);
  return formatted.length > 2000 ? `${formatted.slice(0, 2000)}… [truncated]` : formatted;
}

export function compareToolRevision(snapshot: unknown, current: unknown): ToolRevisionDifference[] | null {
  if (!isRecord(snapshot) || !isRecord(current)) return null;
  return CONFIGURATION_FIELDS.flatMap(([key, label]) => {
    if (stableJson(snapshot[key]) === stableJson(current[key])) return [];
    return [{
      key,
      label,
      previous: formatValue(snapshot[key]),
      current: formatValue(current[key]),
    }];
  });
}
