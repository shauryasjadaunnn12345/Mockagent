export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface MockAgentOptions {
  toolId: string;
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof globalThis.fetch;
}

export interface CallOptions {
  runId?: string;
}

export class MockAgentError extends Error {
  readonly status: number | null;
  readonly body: unknown;
  readonly retryAfterSeconds: number | null;
  readonly retryable: boolean | null;
}

export class MockAgent {
  constructor(options: MockAgentOptions);
  getTool(): Promise<unknown>;
  call(arguments_: JsonValue, options?: CallOptions): Promise<JsonValue>;
  submitFinalAnswer(finalAnswer: string, options: CallOptions & { runId: string }): Promise<unknown>;
}
