export const MAX_PLAYGROUND_TOOLS = 8;
export const MAX_PLAYGROUND_TOOL_CALLS = 5;
export const MAX_PLAYGROUND_PROMPT_LENGTH = 5000;

export function getPlaygroundFunctionName(toolId: string): string {
  return `mock_${toolId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
}

export function parsePlaygroundArguments(
  value: string
):
  | { success: true; arguments: Record<string, unknown> }
  | { success: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { success: false, error: "Tool arguments were not valid JSON." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { success: false, error: "Tool arguments must be a JSON object." };
  }

  return { success: true, arguments: parsed as Record<string, unknown> };
}
