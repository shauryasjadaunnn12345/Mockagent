import assert from "node:assert/strict";
import test from "node:test";
import {
  buildOtlpMetricsPayload,
  buildOtlpTracePayload,
  exportOperationalEvent,
} from "./otel-export.ts";

const event = {
  name: "mockagent.tool.call",
  outcome: "validation_error",
  durationMs: 42,
  transport: "mcp",
};

test("builds OTLP traces with only operational low-cardinality attributes", () => {
  const payload = buildOtlpTracePayload(event, "mockagent-test");
  const span = payload.resourceSpans[0].scopeSpans[0].spans[0];
  assert.equal(payload.resourceSpans[0].resource.attributes[0].value.stringValue, "mockagent-test");
  assert.equal(span.name, "mockagent.tool.call");
  assert.equal(span.status.code, 2);
  assert.deepEqual(span.attributes.map(({ key, value }) => [key, value.stringValue]), [
    ["mockagent.event", "mockagent.tool.call"],
    ["mockagent.outcome", "validation_error"],
    ["mockagent.transport", "mcp"],
  ]);
  assert.equal(JSON.stringify(payload).includes("prompt"), false);
  assert.equal(JSON.stringify(payload).includes("toolId"), false);
  assert.equal(JSON.stringify(payload).includes("run_id"), false);
});

test("builds OTLP counter and duration histogram points", () => {
  const payload = buildOtlpMetricsPayload(event);
  const metrics = payload.resourceMetrics[0].scopeMetrics[0].metrics;
  assert.equal(metrics[0].name, "mockagent.events");
  assert.equal(metrics[0].sum.dataPoints[0].asInt, "1");
  assert.equal(metrics[1].name, "mockagent.event.duration");
  assert.equal(metrics[1].histogram.dataPoints[0].count, "1");
  assert.equal(metrics[1].histogram.dataPoints[0].sum, 42);
  assert.equal(metrics[1].histogram.dataPoints[0].bucketCounts.reduce((sum, count) => sum + Number(count), 0), 1);
});

test("exports to configured OTLP endpoints using standard JSON payloads", async () => {
  const requests = [];
  await exportOperationalEvent(event, {
    env: {
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example.test",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer%20unit-test",
      OTEL_SERVICE_NAME: "mockagent-test",
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return new Response(null, { status: 200 });
    },
  });
  assert.deepEqual(requests.map(({ url }) => url), [
    "https://collector.example.test/v1/traces",
    "https://collector.example.test/v1/metrics",
  ]);
  assert.ok(requests.every(({ init }) =>
    init.method === "POST" &&
    init.headers.Authorization === "Bearer unit-test" &&
    init.redirect === "error"
  ));
});

test("skips export when no collector is configured and ignores unapproved event fields", async () => {
  let fetchCalled = false;
  await exportOperationalEvent(event, {
    env: {},
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(fetchCalled, false);
  const payloads = [];
  await exportOperationalEvent({
    ...event,
    customerData: "private",
    prompt: "sensitive",
    toolId: "tool-secret",
  }, {
    env: { OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://collector.example.test/v1/traces" },
    fetchImpl: async (_url, init) => {
      payloads.push(JSON.parse(init.body));
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(JSON.stringify(payloads).includes("private"), false);
  assert.equal(JSON.stringify(payloads).includes("sensitive"), false);
  assert.equal(JSON.stringify(payloads).includes("tool-secret"), false);
});

test("rejects non-local HTTP collector endpoints", async () => {
  let fetchCalled = false;
  await exportOperationalEvent(event, {
    env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.example.test" },
    fetchImpl: async () => {
      fetchCalled = true;
      return new Response(null, { status: 200 });
    },
  });
  assert.equal(fetchCalled, false);
});
