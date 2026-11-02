export const MAX_PLAYGROUND_TOOLS = 250;
export const MAX_PLAYGROUND_PROMPT_LENGTH = 5000;
export const MAX_PLAYGROUND_API_KEY_LENGTH = 256;

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

export function parsePlaygroundApiKeys(
  value: unknown,
  tools: Array<{ id: string; name: string; require_api_key: boolean }>
):
  | { success: true; apiKeys: Record<string, string> }
  | { success: false; error: string } {
  if (value === undefined) value = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { success: false, error: "Tool API keys must be provided as an object." };
  }

  const toolById = new Map(tools.map((tool) => [tool.id, tool]));
  const apiKeys: Record<string, string> = {};
  for (const [toolId, rawKey] of Object.entries(value)) {
    const tool = toolById.get(toolId);
    if (!tool || !tool.require_api_key) {
      return { success: false, error: "An API key was provided for a tool that does not require one." };
    }
    if (
      typeof rawKey !== "string" ||
      !rawKey.trim() ||
      rawKey.length > MAX_PLAYGROUND_API_KEY_LENGTH ||
      /\s/.test(rawKey)
    ) {
      return { success: false, error: `Enter a valid API key for "${tool.name}".` };
    }
    apiKeys[toolId] = rawKey;
  }

  const missingTool = tools.find((tool) => tool.require_api_key && !apiKeys[tool.id]);
  if (missingTool) {
    return { success: false, error: `Enter the API key for "${missingTool.name}" to use it in this run.` };
  }

  return { success: true, apiKeys };
}
