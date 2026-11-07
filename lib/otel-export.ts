import { randomBytes } from "node:crypto";

export type OperationalEventName =
  | "mockagent.tool.call"
  | "mockagent.regression.run"
  | "mockagent.mcp.request";

export type OperationalOutcome =
  | "success"
  | "validation_error"
  | "policy_violation"
  | "injected_failure"
  | "client_error"
  | "server_error";

export interface OperationalEvent {
  name: OperationalEventName;
  outcome: OperationalOutcome;
  durationMs: number;
  transport?: "http" | "mcp" | "dashboard";
}

interface OtlpConfig {
  tracesEndpoint: string;
  metricsEndpoint: string;
  headers: Record<string, string>;
  serviceName: string;
}

const HISTOGRAM_BOUNDS_MS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const OUTCOMES = new Set<OperationalOutcome>([
  "success",
  "validation_error",
  "policy_violation",
  "injected_failure",
  "client_error",
  "server_error",
]);
const EVENT_NAMES = new Set<OperationalEventName>([
  "mockagent.tool.call",
  "mockagent.regression.run",
  "mockagent.mcp.request",
]);

function nowUnixNano(): string {
  return (BigInt(Date.now()) * BigInt(1_000_000)).toString();
}

function attributesFor(event: OperationalEvent) {
  return [
    { key: "mockagent.event", value: { stringValue: event.name } },
    { key: "mockagent.outcome", value: { stringValue: event.outcome } },
    ...(event.transport
      ? [{ key: "mockagent.transport", value: { stringValue: event.transport } }]
      : []),
  ];
}

function resource(serviceName: string) {
  return {
    attributes: [{ key: "service.name", value: { stringValue: serviceName } }],
  };
}

function getOtlpConfig(env: NodeJS.ProcessEnv = process.env): OtlpConfig | null {
  const commonEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  const tracesEndpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() ||
    (commonEndpoint ? `${commonEndpoint.replace(/\/+$/, "")}/v1/traces` : "");
  const metricsEndpoint = env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT?.trim() ||
    (commonEndpoint ? `${commonEndpoint.replace(/\/+$/, "")}/v1/metrics` : "");
  if (!tracesEndpoint && !metricsEndpoint) return null;

  const headers: Record<string, string> = {};
  for (const header of (env.OTEL_EXPORTER_OTLP_HEADERS ?? "").split(",")) {
    if (!header.trim()) continue;
    const delimiter = header.indexOf("=");
    if (delimiter <= 0) throw new Error("OpenTelemetry headers must use comma-separated key=value pairs.");
    const key = decodeURIComponent(header.slice(0, delimiter).trim());
    const value = decodeURIComponent(header.slice(delimiter + 1).trim());
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(key) || /[\r\n]/.test(value)) {
      throw new Error("OpenTelemetry header configuration contains an invalid header.");
    }
    headers[key] = value;
  }
  for (const endpoint of [tracesEndpoint, metricsEndpoint].filter(Boolean)) {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname))) {
      throw new Error("OpenTelemetry endpoints must use HTTPS, except for localhost.");
    }
  }

  return {
    tracesEndpoint,
    metricsEndpoint,
    headers,
    serviceName: env.OTEL_SERVICE_NAME?.trim() || "mockagent",
  };
}

export function buildOtlpTracePayload(event: OperationalEvent, serviceName = "mockagent") {
  const start = BigInt(Date.now() - Math.max(0, Math.round(event.durationMs))) * BigInt(1_000_000);
  const end = BigInt(Date.now()) * BigInt(1_000_000);
  const spanId = randomBytes(8).toString("hex");
  return {
    resourceSpans: [{
      resource: resource(serviceName),
      scopeSpans: [{
        scope: { name: "mockagent.operational" },
        spans: [{
          traceId: randomBytes(16).toString("hex"),
          spanId,
          name: event.name,
          kind: 1,
          startTimeUnixNano: start.toString(),
          endTimeUnixNano: end.toString(),
          attributes: attributesFor(event),
          status: {
            code: event.outcome === "success" ? 1 : 2,
            ...(event.outcome === "success" ? {} : { message: event.outcome }),
          },
        }],
      }],
    }],
  };
}

export function buildOtlpMetricsPayload(
  event: OperationalEvent,
  serviceName = "mockagent",
) {
  const time = nowUnixNano();
  const attributes = attributesFor(event);
  const durationMs = Math.max(0, event.durationMs);
  const bucketCounts = Array(HISTOGRAM_BOUNDS_MS.length + 1).fill(0);
  const bucketIndex = HISTOGRAM_BOUNDS_MS.findIndex((bound) => durationMs <= bound);
  bucketCounts[bucketIndex === -1 ? bucketCounts.length - 1 : bucketIndex] = 1;
  return {
    resourceMetrics: [{
      resource: resource(serviceName),
      scopeMetrics: [{
        scope: { name: "mockagent.operational" },
        metrics: [
          {
            name: "mockagent.events",
            description: "Number of operational events observed by this MockAgent instance.",
            unit: "{event}",
            sum: {
              dataPoints: [{ attributes, startTimeUnixNano: time, timeUnixNano: time, asInt: "1" }],
              aggregationTemporality: 1,
              isMonotonic: true,
            },
          },
          {
            name: "mockagent.event.duration",
            description: "Duration of operational events in milliseconds.",
            unit: "ms",
            histogram: {
              dataPoints: [{
                attributes,
                startTimeUnixNano: time,
                timeUnixNano: time,
                count: "1",
                sum: durationMs,
                bucketCounts: bucketCounts.map(String),
                explicitBounds: HISTOGRAM_BOUNDS_MS,
                min: durationMs,
                max: durationMs,
              }],
              aggregationTemporality: 1,
            },
          },
        ],
      }],
    }],
  };
}

export async function exportOperationalEvent(
  event: OperationalEvent,
  options: {
    env?: NodeJS.ProcessEnv;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<void> {
  if (!EVENT_NAMES.has(event.name) || !OUTCOMES.has(event.outcome) ||
      !Number.isFinite(event.durationMs) ||
      (event.transport !== undefined && !["http", "mcp", "dashboard"].includes(event.transport))) {
    throw new Error("OpenTelemetry event is invalid.");
  }
  let config: OtlpConfig | null;
  try {
    config = getOtlpConfig(options.env);
  } catch {
    console.error("MockAgent OpenTelemetry configuration is invalid.");
    return;
  }
  if (!config) return;

  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = { "Content-Type": "application/json", ...config.headers };
  const requests = [
    config.tracesEndpoint
      ? {
          endpoint: config.tracesEndpoint,
          payload: buildOtlpTracePayload(event, config.serviceName),
          signal: AbortSignal.timeout(1000),
        }
      : null,
    config.metricsEndpoint
      ? {
          endpoint: config.metricsEndpoint,
          payload: buildOtlpMetricsPayload(event, config.serviceName),
          signal: AbortSignal.timeout(1000),
        }
      : null,
  ].filter((request): request is NonNullable<typeof request> => request !== null);

  await Promise.all(requests.map(async ({ endpoint, payload, signal }) => {
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal,
        redirect: "error",
      });
      if (!response.ok) {
        console.error(`MockAgent OpenTelemetry export failed with HTTP ${response.status}.`);
      }
    } catch {
      console.error("MockAgent OpenTelemetry export request failed.");
    }
  }));
}
