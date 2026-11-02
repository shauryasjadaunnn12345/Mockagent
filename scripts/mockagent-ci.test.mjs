import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scriptPath = fileURLToPath(new URL("./mockagent-ci.mjs", import.meta.url));

async function runCiRunner(caseResults, extraEnv = {}) {
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.setHeader("Content-Type", "application/json");
    if (request.method === "GET" && request.url === "/api/ci/suites") {
      response.end(JSON.stringify({
        suites: [{ id: "suite-1", name: "Refund suite", caseCount: caseResults.length }],
      }));
      return;
    }
    if (request.method === "POST" && request.url === "/api/agent/run") {
      const { caseIndex } = JSON.parse(body);
      response.end(JSON.stringify({ regression: caseResults[caseIndex] }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "Not found" }));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");

  try {
    return await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [scriptPath], {
        env: {
          ...process.env,
          MOCKAGENT_BASE_URL: `http://127.0.0.1:${address.port}`,
          MOCKAGENT_API_KEY: `ma_live_${"a".repeat(64)}`,
          ...extraEnv,
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
      child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, stdout, stderr }));
    });
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("CI runner exits successfully when all saved cases pass", async () => {
  const result = await runCiRunner([
    { passed: true, checks: [{ name: "Exact tool sequence", passed: true }] },
    { passed: true, checks: [{ name: "All calls succeeded", passed: true }] },
  ]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /2 passed, 0 failed/);
});

test("CI runner exits non-zero and names failed checks when a case fails", async () => {
  const result = await runCiRunner([
    { passed: true, checks: [{ name: "Answer phrase", passed: true }] },
    { passed: false, checks: [{ name: "Schema response", passed: false }] },
  ]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /FAIL Refund suite \/ case 2 — Schema response/);
  assert.match(result.stdout, /1 passed, 1 failed/);
});

test("CI runner reports missing requested suite IDs", async () => {
  const result = await runCiRunner(
    [{ passed: true, checks: [] }],
    { MOCKAGENT_SUITE_IDS: "missing-suite" },
  );
  assert.equal(result.code, 2);
  assert.match(result.stderr, /suite IDs were not found/);
});
