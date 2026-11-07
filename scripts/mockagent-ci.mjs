#!/usr/bin/env node

import { appendFile, writeFile } from "node:fs/promises";

const baseUrl = process.env.MOCKAGENT_BASE_URL?.trim()?.replace(/\/+$/, "");
const apiKey = process.env.MOCKAGENT_API_KEY?.trim();
const requestedSuiteIds = new Set(
  (process.env.MOCKAGENT_SUITE_IDS ?? "")
    .split(",")
    .map((suiteId) => suiteId.trim())
    .filter(Boolean),
);

if (!baseUrl || !apiKey) {
  console.error("Set MOCKAGENT_BASE_URL and MOCKAGENT_API_KEY before running the MockAgent CI runner.");
  process.exit(2);
}

let parsedBaseUrl;
try {
  parsedBaseUrl = new URL(baseUrl);
} catch {
  console.error("MOCKAGENT_BASE_URL must be a valid absolute URL.");
  process.exit(2);
}
if (parsedBaseUrl.protocol !== "https:" && parsedBaseUrl.hostname !== "localhost" && parsedBaseUrl.hostname !== "127.0.0.1") {
  console.error("MOCKAGENT_BASE_URL must use HTTPS outside local development.");
  process.exit(2);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  "Content-Type": "application/json",
};

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`MockAgent returned an invalid response (HTTP ${response.status}).`);
  }
}

async function request(path, options) {
  const response = await fetch(new URL(path, `${baseUrl}/`), {
    ...options,
    headers: { ...headers, ...options?.headers },
    signal: AbortSignal.timeout(130_000),
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `MockAgent request failed (HTTP ${response.status}).`);
  }
  return body;
}

let failedCases = 0;
let passedCases = 0;
const results = [];
let runnerError;

function safeText(value) {
  return String(value)
    .replaceAll(apiKey, "[REDACTED]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\b(?:ma_live_|(?:sk|pk|ghp|gho|github_pat|xox[baprs])_)[A-Za-z0-9_-]{12,}\b/gi, "[REDACTED]")
    .replace(/[\r\n\t]/g, " ")
    .slice(0, 500);
}

try {
  const listing = await request("/api/ci/suites", { method: "GET" });
  if (!Array.isArray(listing.suites)) throw new Error("MockAgent returned an invalid suite list.");
  const suites = requestedSuiteIds.size
    ? listing.suites.filter((suite) => requestedSuiteIds.has(suite.id))
    : listing.suites;
  if (requestedSuiteIds.size && suites.length !== requestedSuiteIds.size) {
    const found = new Set(suites.map((suite) => suite.id));
    const missing = [...requestedSuiteIds].filter((suiteId) => !found.has(suiteId));
    throw new Error(`Requested suite IDs were not found in this workspace: ${missing.join(", ")}`);
  }
  if (suites.length === 0) throw new Error("No saved regression suites were selected or found.");

  for (const suite of suites) {
    if (
      typeof suite.id !== "string" ||
      typeof suite.name !== "string" ||
      !Number.isInteger(suite.caseCount) ||
      suite.caseCount < 1 ||
      suite.caseCount > 20
    ) {
      throw new Error("MockAgent returned an invalid suite definition.");
    }

    for (let caseIndex = 0; caseIndex < suite.caseCount; caseIndex += 1) {
      const label = `${suite.name} / case ${caseIndex + 1}`;
      try {
        const result = await request("/api/agent/run", {
          method: "POST",
          body: JSON.stringify({ suiteId: suite.id, caseIndex }),
        });
        const regression = result.regression;
        if (!regression || typeof regression.passed !== "boolean" || !Array.isArray(regression.checks)) {
          throw new Error("Regression run did not return valid checks.");
        }
        const failed = regression.checks.filter((check) => check && check.passed === false);
        const detail = failed.map((check) => check.name).join("; ");
        results.push({ label: safeText(label), passed: regression.passed, detail: safeText(detail) });
        if (regression.passed) {
          passedCases += 1;
          console.log(`PASS ${safeText(label)}`);
        } else {
          failedCases += 1;
          console.error(`FAIL ${safeText(label)}${detail ? ` — ${safeText(detail)}` : ""}`);
        }
      } catch (error) {
        failedCases += 1;
        const detail = safeText(error instanceof Error ? error.message : "Regression request failed.");
        results.push({ label: safeText(label), passed: false, detail });
        console.error(`ERROR ${safeText(label)} — ${detail}`);
      }
    }
  }
} catch (error) {
  runnerError = safeText(error instanceof Error ? error.message : "MockAgent CI run failed.");
  console.error(runnerError);
}

console.log(`MockAgent regression results: ${passedCases} passed, ${failedCases} failed.`);

const report = {
  status: runnerError ? "error" : failedCases ? "failed" : "passed",
  passedCases,
  failedCases,
  error: runnerError ?? null,
  results,
};

if (process.env.MOCKAGENT_RESULT_FILE) {
  try {
    await writeFile(process.env.MOCKAGENT_RESULT_FILE, JSON.stringify(report), "utf8");
  } catch (error) {
    console.error("Could not write MockAgent regression results:", error);
    process.exitCode = 2;
  }
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results.map(({ label, passed, detail }) =>
    `| ${passed ? "PASS" : "FAIL"} | ${label.replaceAll("|", "\\|")} | ${detail.replaceAll("|", "\\|")} |`
  );
  const summary = [
    "## MockAgent regression results",
    "",
    `**${passedCases} passed · ${failedCases} failed**`,
    ...(runnerError ? ["", `**Runner error:** ${runnerError.replaceAll("|", "\\|")}`] : []),
    "",
    "| Result | Test case | Failed checks / error |",
    "|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  try {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, summary, "utf8");
  } catch (error) {
    console.error("Could not write GitHub Actions step summary:", error);
    process.exitCode = 2;
  }
}

if (runnerError) process.exitCode = 2;
else if (failedCases > 0) process.exitCode = 1;
