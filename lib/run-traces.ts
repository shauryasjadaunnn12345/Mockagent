export const MAX_TRACE_ARGUMENTS_LENGTH = 4000;
export const MAX_TRACE_RESPONSE_LENGTH = 6000;

export interface RunTraceCall {
  toolId: string;
  toolName: string;
  arguments: string;
  response: string;
  status: number;
}

export interface RunTrace {
  answer: string;
  calls: RunTraceCall[];
}

export interface RunTraceDifference {
  label: string;
  before: string;
  after: string;
}

function boundedJson(value: unknown, maxLength: number): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    serialized = String(value);
  }
  if (serialized.length <= maxLength) return serialized;
  let fingerprint = 2166136261;
  for (let index = 0; index < serialized.length; index += 1) {
    fingerprint = Math.imul(fingerprint ^ serialized.charCodeAt(index), 16777619);
  }
  return `${serialized.slice(0, maxLength)}… [truncated; ${serialized.length} chars, fingerprint ${fingerprint >>> 0}]`;
}

export function createRunTrace(
  answer: string,
  calls: Array<{
    toolId: string;
    toolName: string;
    arguments: Record<string, unknown> | null;
    rawArguments?: string;
    response: unknown;
    status: number;
  }>
): RunTrace {
  return {
    answer: answer.slice(0, 12000),
    calls: calls.map((call) => ({
      toolId: call.toolId,
      toolName: call.toolName.slice(0, 100),
      arguments: boundedJson(call.arguments ?? call.rawArguments ?? null, MAX_TRACE_ARGUMENTS_LENGTH),
      response: boundedJson(call.response, MAX_TRACE_RESPONSE_LENGTH),
      status: call.status,
    })),
  };
}

export function compareRunTraces(before: RunTrace, after: RunTrace): RunTraceDifference[] {
  const differences: RunTraceDifference[] = [];

  if (before.answer !== after.answer) {
    differences.push({
      label: "Final answer",
      before: before.answer,
      after: after.answer,
    });
  }

  if (before.calls.length !== after.calls.length) {
    differences.push({
      label: "Tool call count",
      before: String(before.calls.length),
      after: String(after.calls.length),
    });
  }

  const maxCalls = Math.max(before.calls.length, after.calls.length);
  for (let index = 0; index < maxCalls; index += 1) {
    const oldCall = before.calls[index];
    const newCall = after.calls[index];
    const callLabel = `Call ${index + 1}`;

    if (!oldCall || !newCall) {
      differences.push({
        label: `${callLabel} tool`,
        before: oldCall?.toolName ?? "(no call)",
        after: newCall?.toolName ?? "(no call)",
      });
      continue;
    }

    if (oldCall.toolId !== newCall.toolId || oldCall.toolName !== newCall.toolName) {
      differences.push({ label: `${callLabel} tool`, before: oldCall.toolName, after: newCall.toolName });
    }
    if (oldCall.arguments !== newCall.arguments) {
      differences.push({ label: `${callLabel} arguments`, before: oldCall.arguments, after: newCall.arguments });
    }
    if (oldCall.status !== newCall.status) {
      differences.push({
        label: `${callLabel} HTTP status`,
        before: String(oldCall.status),
        after: String(newCall.status),
      });
    }
    if (oldCall.response !== newCall.response) {
      differences.push({ label: `${callLabel} response`, before: oldCall.response, after: newCall.response });
    }
  }

  return differences;
}
