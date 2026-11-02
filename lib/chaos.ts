export const INJECTABLE_HTTP_STATUSES = [429, 500, 502, 503] as const;

export interface InjectedFailure {
  step: number;
  status: (typeof INJECTABLE_HTTP_STATUSES)[number];
  errorCode: string;
  message: string;
  retryAfterSeconds?: number;
}

export function parseChaosConfig(value: unknown): InjectedFailure[] {
  if (!Array.isArray(value) || value.length > 20) {
    throw new Error("Scenario failures must be an array with at most 20 entries.");
  }

  const steps = new Set<number>();
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`Scenario failure ${index + 1} must be an object.`);
    }

    const failure = entry as Record<string, unknown>;
    if (
      typeof failure.step !== "number" ||
      !Number.isInteger(failure.step) ||
      failure.step < 1 ||
      failure.step > 100
    ) {
      throw new Error(`Scenario failure ${index + 1} step must be an integer from 1 to 100.`);
    }
    if (steps.has(failure.step)) {
      throw new Error(`Scenario failure step ${failure.step} is configured more than once.`);
    }
    steps.add(failure.step);

    if (
      typeof failure.status !== "number" ||
      !INJECTABLE_HTTP_STATUSES.includes(failure.status as InjectedFailure["status"])
    ) {
      throw new Error(`Scenario failure ${index + 1} status must be 429, 500, 502, or 503.`);
    }
    if (
      typeof failure.errorCode !== "string" ||
      !/^[A-Z][A-Z0-9_]{2,63}$/.test(failure.errorCode)
    ) {
      throw new Error(`Scenario failure ${index + 1} needs an uppercase errorCode.`);
    }
    if (
      typeof failure.message !== "string" ||
      !failure.message.trim() ||
      failure.message.length > 300
    ) {
      throw new Error(`Scenario failure ${index + 1} message must contain 1 to 300 characters.`);
    }
    if (
      failure.retryAfterSeconds !== undefined &&
      (
        typeof failure.retryAfterSeconds !== "number" ||
        !Number.isInteger(failure.retryAfterSeconds) ||
        failure.retryAfterSeconds < 1 ||
        failure.retryAfterSeconds > 60
      )
    ) {
      throw new Error(`Scenario failure ${index + 1} retryAfterSeconds must be an integer from 1 to 60.`);
    }

    return {
      step: failure.step,
      status: failure.status as InjectedFailure["status"],
      errorCode: failure.errorCode,
      message: failure.message.trim(),
      ...(failure.retryAfterSeconds === undefined
        ? {}
        : { retryAfterSeconds: failure.retryAfterSeconds as number }),
    };
  });
}

export function resolveInjectedFailure(
  failures: InjectedFailure[] | undefined,
  step: number,
): InjectedFailure | null {
  return failures?.find((failure) => failure.step === step) ?? null;
}
