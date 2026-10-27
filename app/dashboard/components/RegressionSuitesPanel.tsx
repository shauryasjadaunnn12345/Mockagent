"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, Play, Plus, Trash2 } from "lucide-react";
import {
  createRegressionSuite,
  deleteRegressionSuite,
  loadMoreRegressionRuns,
} from "@/app/actions/agent-tests";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PLAYGROUND_TOOLS } from "@/lib/agent-playground";
import { compareRunTraces, type RunTrace } from "@/lib/run-traces";
import {
  MAX_REGRESSION_TEST_CASES,
  isResponseAssertionOperator,
  parseRegressionResponseAssertions,
  type RegressionResponseAssertion,
  type RegressionTestCase,
} from "@/lib/regression-suites";
import { analyzeRegressionRuns } from "@/lib/regression-analytics";
import type { Json } from "@/types/database";

export interface RegressionToolOption {
  id: string;
  name: string;
  is_active: boolean;
  require_api_key: boolean;
}

export interface RegressionSuiteOption {
  id: string;
  name: string;
  prompt: string;
  test_cases: RegressionTestCase[];
  tool_ids: string[];
  expected_tool_ids: string[] | null;
  required_answer_text: string[];
  response_assertions: Json;
  created_at: string;
}

export interface RegressionRunOption {
  id: string;
  suite_id: string;
  run_id: string;
  status: string;
  test_case_index: number;
  test_case_name: string;
  checks: Json;
  answer: string;
  model: string;
  trace: Json | null;
  created_at: string;
}

interface RegressionResult {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; expected: string | string[]; actual: string | string[] }>;
}

interface BatchRunResult {
  suiteId: string;
  caseIndex: number;
  suiteName: string;
  caseName: string;
  status: "passed" | "failed" | "error";
  error?: string;
}

interface BatchProgress {
  total: number;
  completed: number;
  currentSuiteName: string | null;
  stopping: boolean;
  results: BatchRunResult[];
}

interface RegressionSuitesPanelProps {
  workspaceId: string;
  tools: RegressionToolOption[];
  suites: RegressionSuiteOption[];
  recentRuns: RegressionRunOption[];
  hasMoreRuns: boolean;
  schemaReady: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRegressionResult(value: unknown): RegressionResult | null {
  if (!isRecord(value) || typeof value.passed !== "boolean" || !Array.isArray(value.checks)) return null;
  const checks = value.checks.filter(
    (check): check is RegressionResult["checks"][number] =>
      isRecord(check) &&
      typeof check.name === "string" &&
      typeof check.passed === "boolean" &&
      (typeof check.expected === "string" || Array.isArray(check.expected)) &&
      (typeof check.actual === "string" || Array.isArray(check.actual)),
  );
  return { passed: value.passed, checks };
}

function readRunTrace(value: unknown): RunTrace | null {
  if (!isRecord(value) || typeof value.answer !== "string" || !Array.isArray(value.calls)) return null;
  const calls = value.calls.filter(
    (call): call is RunTrace["calls"][number] =>
      isRecord(call) &&
      typeof call.toolId === "string" &&
      typeof call.toolName === "string" &&
      typeof call.arguments === "string" &&
      typeof call.response === "string" &&
      typeof call.status === "number",
  );
  if (calls.length !== value.calls.length) return null;
  return { answer: value.answer, calls };
}

function formatCheckValue(value: string | string[]): string {
  const formatted = Array.isArray(value) ? JSON.stringify(value) : value;
  return formatted.length <= 500 ? formatted : `${formatted.slice(0, 500)}… [truncated]`;
}

function readResponseAssertionSummaries(value: unknown, toolById: Map<string, RegressionToolOption>): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((assertion) => {
    if (
      !isRecord(assertion) ||
      typeof assertion.toolId !== "string" ||
      typeof assertion.path !== "string" ||
      typeof assertion.operator !== "string" ||
      !isResponseAssertionOperator(assertion.operator)
    ) return [];
    const toolName = toolById.get(assertion.toolId)?.name ?? "Deleted tool";
    return [`${toolName} → ${assertion.path} ${assertion.operator.replaceAll("_", " ")}${
      assertion.operator === "exists" ? "" : ` ${JSON.stringify(assertion.expected)}`
    }`];
  });
}

export function RegressionSuitesPanel({
  workspaceId,
  tools,
  suites,
  recentRuns,
  hasMoreRuns: initialHasMoreRuns,
  schemaReady,
}: RegressionSuitesPanelProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [testCases, setTestCases] = useState<RegressionTestCase[]>([{ name: "Case 1", prompt: "" }]);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [checksToolSequence, setChecksToolSequence] = useState(false);
  const [expectedToolIds, setExpectedToolIds] = useState<string[]>([]);
  const [expectedToolToAdd, setExpectedToolToAdd] = useState("");
  const [requiredText, setRequiredText] = useState("");
  const [responseAssertions, setResponseAssertions] = useState<RegressionResponseAssertion[]>([]);
  const [assertionToolId, setAssertionToolId] = useState("");
  const [assertionPath, setAssertionPath] = useState("");
  const [assertionOperator, setAssertionOperator] = useState<RegressionResponseAssertion["operator"]>("equals");
  const [assertionExpected, setAssertionExpected] = useState('""');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [runningSuiteId, setRunningSuiteId] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<Record<string, RegressionResult>>({});
  const [runErrors, setRunErrors] = useState<Record<string, string>>({});
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [loadedRuns, setLoadedRuns] = useState(recentRuns);
  const [hasMoreRuns, setHasMoreRuns] = useState(initialHasMoreRuns);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const stopBatchRef = useRef(false);
  const [isPending, startTransition] = useTransition();
  const selectableTools = tools.filter((tool) => tool.is_active && !tool.require_api_key);
  const toolById = new Map(tools.map((tool) => [tool.id, tool]));
  const analytics = analyzeRegressionRuns(loadedRuns);
  const suiteNameById = new Map(suites.map((suite) => [suite.id, suite.name]));
  const recentRunsBySuiteId = new Map<string, RegressionRunOption[]>();
  for (const run of loadedRuns) {
    const suiteRuns = recentRunsBySuiteId.get(run.suite_id) ?? [];
    suiteRuns.push(run);
    recentRunsBySuiteId.set(run.suite_id, suiteRuns);
  }

  function addTestCase() {
    if (testCases.length >= MAX_REGRESSION_TEST_CASES) return;
    let number = testCases.length + 1;
    while (testCases.some((testCase) => testCase.name.trim().toLocaleLowerCase() === `case ${number}`)) {
      number += 1;
    }
    setTestCases((current) => [...current, { name: `Case ${number}`, prompt: "" }]);
  }

  function toggleTool(toolId: string) {
    if (selectedToolIds.includes(toolId)) {
      setSelectedToolIds((current) => current.filter((id) => id !== toolId));
      setExpectedToolIds((current) => current.filter((id) => id !== toolId));
      setResponseAssertions((current) => current.filter((assertion) => assertion.toolId !== toolId));
      if (assertionToolId === toolId) {
        setAssertionToolId(selectedToolIds.find((id) => id !== toolId) ?? "");
      }
      return;
    }
    if (selectedToolIds.length >= MAX_PLAYGROUND_TOOLS) return;
    setSelectedToolIds((current) => [...current, toolId]);
    if (!assertionToolId) setAssertionToolId(toolId);
  }

  function addExpectedTool() {
    if (!expectedToolToAdd || expectedToolIds.includes(expectedToolToAdd)) return;
    setExpectedToolIds((current) => [...current, expectedToolToAdd]);
    setExpectedToolToAdd("");
  }

  function moveExpectedTool(index: number, offset: number) {
    const destination = index + offset;
    if (destination < 0 || destination >= expectedToolIds.length) return;
    setExpectedToolIds((current) => {
      const next = [...current];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  }

  function addResponseAssertion() {
    setError(null);
    if (!assertionToolId || !assertionPath.trim()) {
      setError("Choose a selected tool and enter a response field path.");
      return;
    }
    if (responseAssertions.length >= 20) {
      setError("A test can have at most 20 tool-response assertions.");
      return;
    }

    let expected: unknown;
    if (assertionOperator !== "exists") {
      try {
        expected = JSON.parse(assertionExpected);
      } catch {
        setError("Expected value must be valid JSON, such as \"shipped\", 100, or true.");
        return;
      }
    }
    try {
      const [assertion] = parseRegressionResponseAssertions([{
        toolId: assertionToolId,
        path: assertionPath.trim(),
        operator: assertionOperator,
        ...(assertionOperator === "exists" ? {} : { expected }),
      }], selectedToolIds);
      setResponseAssertions((current) => [...current, assertion]);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Tool-response assertion is invalid.");
      return;
    }
    setAssertionPath("");
  }

  function saveSuite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const result = await createRegressionSuite({
        name,
        prompt: testCases[0]?.prompt ?? "",
        testCases,
        toolIds: selectedToolIds,
        expectedToolIds: checksToolSequence ? expectedToolIds : null,
        requiredAnswerText: requiredText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
        responseAssertions,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setName("");
      setTestCases([{ name: "Case 1", prompt: "" }]);
      setRequiredText("");
      setResponseAssertions([]);
      setExpectedToolIds([]);
      setChecksToolSequence(false);
      setNotice("Regression test saved.");
      router.refresh();
    });
  }

  async function executeSuite(
    suiteId: string,
    caseIndex: number
  ): Promise<{ regression: RegressionResult | null; error: string | null }> {
    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ suiteId, caseIndex }),
      });
      const body: unknown = await response.json();
      const responseBody = isRecord(body) ? body : {};
      const regression = readRegressionResult(responseBody.regression);
      if (!response.ok) {
        return {
          regression: null,
          error: typeof responseBody.error === "string" ? responseBody.error : "Regression test run failed.",
        };
      }
      if (!regression) {
        return { regression: null, error: "Regression test completed without a valid result." };
      }
      return { regression, error: null };
    } catch (requestError) {
      return {
        regression: null,
        error: requestError instanceof Error ? requestError.message : "Regression test run failed.",
      };
    }
  }

  async function runSuite(suiteId: string) {
    setError(null);
    setNotice(null);
    setRunningSuiteId(suiteId);
    setRunErrors((current) => {
      const next = { ...current };
      delete next[suiteId];
      return next;
    });
    setRunResults((current) => {
      const next = { ...current };
      delete next[suiteId];
      return next;
    });

    const suite = suites.find((item) => item.id === suiteId);
    if (!suite) {
      setRunErrors((current) => ({ ...current, [suiteId]: "Regression test not found." }));
      setRunningSuiteId(null);
      return;
    }
    const checks: RegressionResult["checks"] = [];
    const errors: string[] = [];
    let allPassed = true;
    for (let caseIndex = 0; caseIndex < suite.test_cases.length; caseIndex += 1) {
      const testCase = suite.test_cases[caseIndex];
      const outcome = await executeSuite(suiteId, caseIndex);
      if (!outcome.regression) {
        allPassed = false;
        const message = outcome.error ?? "Test case failed to run.";
        errors.push(`${testCase.name}: ${message}`);
        checks.push({
          name: `${testCase.name}: execution`,
          passed: false,
          expected: "A completed test run",
          actual: message,
        });
        continue;
      }
      allPassed = allPassed && outcome.regression.passed;
      checks.push({
        name: `${testCase.name}: result`,
        passed: outcome.regression.passed,
        expected: "All checks pass",
        actual: outcome.regression.passed ? "Passed" : "One or more checks failed",
      });
      checks.push(...outcome.regression.checks.map((check) => ({
        ...check,
        name: `${testCase.name}: ${check.name}`,
      })));
    }
    setRunResults((current) => ({ ...current, [suiteId]: { passed: allPassed, checks } }));
    setRunErrors((current) => ({
      ...current,
      ...(errors.length > 0 ? { [suiteId]: errors.join(" · ") } : {}),
    }));
    if (errors.length > 0) setError(errors.join(" · "));
    router.refresh();
    setRunningSuiteId(null);
  }

  async function runAllSuites() {
    const totalCases = suites.reduce((total, suite) => total + suite.test_cases.length, 0);
    if (!confirm(
      `Run all ${totalCases} saved test cases sequentially? Each case can make multiple model requests and use your Baseten credits.`
    )) return;

    stopBatchRef.current = false;
    setError(null);
    setNotice(null);
    setRunErrors({});
    setRunResults({});
    setBatchProgress({
      total: totalCases,
      completed: 0,
      currentSuiteName: null,
      stopping: false,
      results: [],
    });

    const results: BatchRunResult[] = [];
    for (const suite of suites) {
      for (let caseIndex = 0; caseIndex < suite.test_cases.length; caseIndex += 1) {
        if (stopBatchRef.current) break;

        const testCase = suite.test_cases[caseIndex];
        setRunningSuiteId(suite.id);
        setBatchProgress((current) => current
          ? { ...current, currentSuiteName: `${suite.name} / ${testCase.name}` }
          : current);
        const outcome = await executeSuite(suite.id, caseIndex);

        const result: BatchRunResult = {
          suiteId: suite.id,
          caseIndex,
          suiteName: suite.name,
          caseName: testCase.name,
          status: outcome.error ? "error" : outcome.regression?.passed ? "passed" : "failed",
          ...(outcome.error ? { error: outcome.error } : {}),
        };
        results.push(result);
        setBatchProgress((current) => current
          ? { ...current, completed: results.length, results: [...results] }
          : current);
      }
      if (stopBatchRef.current) break;
    }

    setRunningSuiteId(null);
    setBatchProgress((current) => current ? { ...current, currentSuiteName: null } : current);
    if (results.length > 0) router.refresh();
  }

  function stopBatchAfterCurrent() {
    stopBatchRef.current = true;
    setBatchProgress((current) => current ? { ...current, stopping: true } : current);
  }

  async function loadOlderRuns() {
    const cursorRun = loadedRuns[loadedRuns.length - 1];
    if (!cursorRun || loadingMoreRuns || !hasMoreRuns) return;
    setLoadingMoreRuns(true);
    setHistoryError(null);
    try {
      const result = await loadMoreRegressionRuns(workspaceId, {
        created_at: cursorRun.created_at,
        id: cursorRun.id,
      });
      if (!result.success) {
        setHistoryError(result.error);
        return;
      }
      setLoadedRuns((current) => [...current, ...result.runs]);
      setHasMoreRuns(result.hasMore);
    } catch (error) {
      console.error("MockAgent: failed to load older regression runs", error);
      setHistoryError("Could not load older regression runs.");
    } finally {
      setLoadingMoreRuns(false);
    }
  }

  function removeSuite(suiteId: string, suiteName: string) {
    if (!confirm(`Delete regression test "${suiteName}" and its run history?`)) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteRegressionSuite(suiteId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setNotice("Regression test deleted.");
      router.refresh();
    });
  }

  function renderResult(result: RegressionResult) {
    return (
      <div className="mt-3 space-y-1">
        <p className={`text-sm font-medium ${result.passed ? "text-emerald-700" : "text-red-700"}`}>
          {result.passed ? "Passed" : "Failed"}
        </p>
        {result.checks.map((check, index) => (
          <div key={`${check.name}-${index}`} className={`text-xs ${check.passed ? "text-emerald-700" : "text-red-700"}`}>
            <p>{check.passed ? "✓" : "✗"} {check.name}</p>
            <p className="ml-4 break-all text-slate-500">
              Expected: {formatCheckValue(check.expected)} · Actual: {formatCheckValue(check.actual)}
            </p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold text-slate-900">Regression Tests</CardTitle>
        <p className="text-sm text-slate-500">
          Save prompts and expectations, then rerun them after changing your agent or mock tools.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {!schemaReady ? (
          <p role="status" className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">
            Run the latest <code>schema.sql</code> in Supabase to enable saved regression tests and run history.
          </p>
        ) : selectableTools.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">
            Create an active mock tool without API-key protection before saving a regression test.
          </p>
        ) : (
          <form onSubmit={saveSuite} className="space-y-4 rounded-md border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-800">Create a test</h3>
            <div className="space-y-1.5">
              <Label htmlFor="regression-name">Test name</Label>
              <Input id="regression-name" value={name} onChange={(event) => setName(event.currentTarget.value)} maxLength={80} required />
            </div>
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-slate-800">
                Test cases ({testCases.length}/{MAX_REGRESSION_TEST_CASES})
              </legend>
              <p className="text-xs text-slate-500">
                Each case runs as a separate model request and shares this test&apos;s tool and answer checks.
              </p>
              {testCases.map((testCase, index) => (
                <div key={index} className="space-y-2 rounded border border-slate-200 p-3">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label={`Test case ${index + 1} name`}
                      value={testCase.name}
                      onChange={(event) => {
                        const name = event.currentTarget.value;
                        setTestCases((current) => current.map((item, itemIndex) =>
                          itemIndex === index ? { ...item, name } : item
                        ));
                      }}
                      maxLength={80}
                      placeholder={`Case ${index + 1}`}
                      required
                    />
                    {testCases.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove test case ${index + 1}`}
                        onClick={() => setTestCases((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                  <Textarea
                    aria-label={`Prompt for test case ${index + 1}`}
                    value={testCase.prompt}
                    onChange={(event) => {
                      const promptValue = event.currentTarget.value;
                      setTestCases((current) => current.map((item, itemIndex) =>
                        itemIndex === index ? { ...item, prompt: promptValue } : item
                      ));
                    }}
                    maxLength={5000}
                    rows={3}
                    required
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addTestCase}
                disabled={testCases.length >= MAX_REGRESSION_TEST_CASES || isPending}
              >
                <Plus className="h-4 w-4" /> Add test case
              </Button>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-800">Available tools</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {tools.map((tool) => {
                  const unavailable = !tool.is_active || tool.require_api_key;
                  return (
                    <label key={tool.id} className={`flex items-center gap-2 rounded border p-2 text-sm ${unavailable ? "text-slate-400" : "text-slate-700"}`}>
                      <input
                        type="checkbox"
                        checked={selectedToolIds.includes(tool.id)}
                        onChange={() => toggleTool(tool.id)}
                        disabled={unavailable || (!selectedToolIds.includes(tool.id) && selectedToolIds.length >= MAX_PLAYGROUND_TOOLS) || isPending}
                      />
                      {tool.name}{unavailable && <span className="text-xs">(unavailable)</span>}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-2 rounded border border-slate-200 p-3">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                <input type="checkbox" checked={checksToolSequence} onChange={(event) => setChecksToolSequence(event.currentTarget.checked)} />
                Assert the exact ordered tool-call sequence
              </label>
              {checksToolSequence && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <select
                      aria-label="Tool to add to expected sequence"
                      className="h-9 min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-2 text-sm"
                      value={expectedToolToAdd}
                      onChange={(event) => setExpectedToolToAdd(event.currentTarget.value)}
                    >
                      <option value="">Choose a selected tool</option>
                      {selectedToolIds.filter((id) => !expectedToolIds.includes(id)).map((id) => (
                        <option key={id} value={id}>{toolById.get(id)?.name ?? "Unknown tool"}</option>
                      ))}
                    </select>
                    <Button type="button" variant="outline" size="sm" onClick={addExpectedTool} disabled={!expectedToolToAdd}>
                      <Plus className="h-4 w-4" /> Add
                    </Button>
                  </div>
                  {expectedToolIds.length === 0 ? (
                    <p className="text-xs text-slate-500">An empty sequence asserts that the agent must not call any tools.</p>
                  ) : (
                    <ol className="space-y-1">
                      {expectedToolIds.map((id, index) => (
                        <li key={`${id}-${index}`} className="flex items-center gap-2 rounded bg-slate-50 px-2 py-1 text-sm">
                          <span className="w-5 text-xs text-slate-500">{index + 1}.</span>
                          <span className="min-w-0 flex-1 truncate">{toolById.get(id)?.name ?? "Unknown tool"}</span>
                          <Button type="button" variant="ghost" size="icon" aria-label="Move expected tool up" disabled={index === 0} onClick={() => moveExpectedTool(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
                          <Button type="button" variant="ghost" size="icon" aria-label="Move expected tool down" disabled={index === expectedToolIds.length - 1} onClick={() => moveExpectedTool(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
                          <Button type="button" variant="ghost" size="icon" aria-label="Remove expected tool" onClick={() => setExpectedToolIds((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="regression-answer-phrases">Required answer phrases (one per line)</Label>
              <Textarea id="regression-answer-phrases" value={requiredText} onChange={(event) => setRequiredText(event.currentTarget.value)} maxLength={4000} rows={3} placeholder={"refund processed\norder 123"} />
              <p className="text-xs text-slate-500">Checks are case-insensitive substring matches. Add at least one phrase, a tool-response assertion, or enable exact tool-sequence checking.</p>
            </div>

            <div className="space-y-3 rounded border border-slate-200 p-3">
              <div>
                <h4 className="text-sm font-medium text-slate-800">Tool-response assertions</h4>
                <p className="mt-1 text-xs text-slate-500">
                  Check a JSON field from the first call to a selected tool. Paths use dot notation, for example <code>data.status</code> or <code>items.0.id</code>.
                </p>
              </div>
              {responseAssertions.length > 0 && (
                <ul className="space-y-2">
                  {responseAssertions.map((assertion, index) => (
                    <li key={`${assertion.toolId}-${assertion.path}-${index}`} className="flex items-start gap-2 rounded bg-slate-50 p-2 text-xs">
                      <span className="min-w-0 flex-1 break-all">
                        <strong>{toolById.get(assertion.toolId)?.name ?? "Selected tool"}</strong>
                        {" → "}<code>{assertion.path}</code>{" "}
                        <strong>{assertion.operator.replaceAll("_", " ")}</strong>
                        {assertion.operator !== "exists" && <> <code>{JSON.stringify(assertion.expected)}</code></>}
                      </span>
                      <Button type="button" variant="ghost" size="icon" aria-label="Remove response assertion" onClick={() => setResponseAssertions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid gap-2 sm:grid-cols-2">
                <select
                  aria-label="Tool for response assertion"
                  className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm"
                  value={assertionToolId}
                  onChange={(event) => setAssertionToolId(event.currentTarget.value)}
                >
                  <option value="">Choose a selected tool</option>
                  {selectedToolIds.map((id) => <option key={id} value={id}>{toolById.get(id)?.name ?? "Unknown tool"}</option>)}
                </select>
                <Input
                  aria-label="JSON response field path"
                  value={assertionPath}
                  onChange={(event) => setAssertionPath(event.currentTarget.value)}
                  placeholder="data.status"
                  maxLength={200}
                />
                <select
                  aria-label="Response assertion operator"
                  className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm"
                  value={assertionOperator}
                  onChange={(event) => {
                    if (isResponseAssertionOperator(event.currentTarget.value)) {
                      setAssertionOperator(event.currentTarget.value);
                    }
                  }}
                >
                  <option value="equals">Equals</option>
                  <option value="contains">Contains</option>
                  <option value="exists">Exists</option>
                  <option value="greater_than">Greater than</option>
                  <option value="less_than">Less than</option>
                </select>
                {assertionOperator !== "exists" && (
                  <Input
                    aria-label="Expected JSON value"
                    value={assertionExpected}
                    onChange={(event) => setAssertionExpected(event.currentTarget.value)}
                    placeholder={'"shipped", 100, or true'}
                  />
                )}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={addResponseAssertion} disabled={selectedToolIds.length === 0 || responseAssertions.length >= 20}>
                <Plus className="h-4 w-4" /> Add assertion
              </Button>
            </div>

            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
            <Button type="submit" disabled={isPending || selectedToolIds.length === 0}>
              <Plus className="h-4 w-4" />
              {isPending ? "Saving…" : "Save regression test"}
            </Button>
          </form>
        )}

        <section aria-labelledby="regression-analytics-title" className="space-y-4 rounded-md border border-slate-200 p-4">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h3 id="regression-analytics-title" className="text-sm font-semibold text-slate-800">Test analytics</h3>
              <p className="text-xs text-slate-500">
                Analytics reflect {analytics.totalRuns} valid runs among {loadedRuns.length} loaded records.
                {hasMoreRuns ? " More retained history is available below." : " All retained history is loaded."}
              </p>
            </div>
            {analytics.trend !== "insufficient" && (
              <p className={`text-xs font-medium ${
                analytics.trend === "improving" ? "text-emerald-700" :
                  analytics.trend === "regressing" ? "text-red-700" : "text-slate-600"
              }`}>
                Recent trend: {analytics.trend} · {analytics.recentPassRate}% vs {analytics.previousPassRate}%
              </p>
            )}
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Pass rate", value: `${analytics.passRate}%`, detail: `${analytics.passedRuns} passed of ${analytics.totalRuns}` },
              { label: "Failed runs", value: String(analytics.failedRuns), detail: "in loaded run history" },
              { label: "Recent window", value: analytics.recentPassRate === null ? "—" : `${analytics.recentPassRate}%`, detail: "latest up to 10 runs" },
              { label: "Avg. tool calls", value: analytics.averageToolCalls === null ? "—" : analytics.averageToolCalls.toFixed(1), detail: "per run with a valid trace" },
            ].map((metric) => (
              <div key={metric.label} className="rounded border border-slate-100 bg-slate-50 p-3">
                <p className="text-xs text-slate-500">{metric.label}</p>
                <p className="mt-1 text-xl font-semibold text-slate-900">{metric.value}</p>
                <p className="text-xs text-slate-500">{metric.detail}</p>
              </div>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded border border-slate-100 p-3">
              <h4 className="text-sm font-medium text-slate-800">Daily results · last 7 days</h4>
              <div className="mt-3 grid grid-cols-7 gap-2" role="img" aria-label="Daily passed and failed regression runs over the last seven days">
                {analytics.days.map((day) => {
                  const total = day.passed + day.failed;
                  const passedHeight = total ? Math.max(4, Math.round((day.passed / total) * 100)) : 0;
                  const failedHeight = total ? Math.max(4, Math.round((day.failed / total) * 100)) : 0;
                  return (
                    <div key={day.date} className="flex min-w-0 flex-col items-center gap-1">
                      <span className="text-[10px] text-slate-500">{total || "—"}</span>
                      <div className="flex h-20 w-full items-end justify-center gap-0.5 rounded bg-slate-50 p-1" title={`${day.date}: ${day.passed} passed, ${day.failed} failed`}>
                        <span className="w-2/5 rounded-t bg-emerald-500" style={{ height: `${passedHeight}%` }} />
                        <span className="w-2/5 rounded-t bg-red-400" style={{ height: `${failedHeight}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-500">{new Date(`${day.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", timeZone: "UTC" })}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-slate-500">Green = passed · red = failed</p>
            </div>

            <div className="rounded border border-slate-100 p-3">
              <h4 className="text-sm font-medium text-slate-800">Recurring failed checks</h4>
              {analytics.failingChecks.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">
                  {analytics.totalRuns ? "No failed checks in the loaded run history." : "Run saved tests to identify recurring failures."}
                </p>
              ) : (
                <div className="mt-2 space-y-3">
                  {analytics.failingChecks.slice(0, 5).map((check) => (
                    <div key={check.name}>
                      <div className="flex justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-slate-700" title={check.name}>{check.name}</span>
                        <span className="shrink-0 text-red-700">{check.failures}/{check.evaluations} failed · {check.failureRate}%</span>
                      </div>
                      <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-100" role="meter" aria-label={`${check.name} failure rate`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={check.failureRate}>
                        <div className="h-full bg-red-400" style={{ width: `${check.failureRate}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="overflow-x-auto rounded border border-slate-100 p-3">
              <h4 className="text-sm font-medium text-slate-800">Per-test reliability</h4>
              {analytics.suites.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">No saved-test runs to analyze yet.</p>
              ) : (
                <table className="mt-2 w-full text-left text-xs">
                  <thead className="text-slate-500">
                    <tr><th className="py-1 pr-3 font-medium">Test</th><th className="py-1 pr-3 font-medium">Pass rate</th><th className="py-1 pr-3 font-medium">Runs</th><th className="py-1 font-medium">Latest streak</th></tr>
                  </thead>
                  <tbody>
                    {analytics.suites.slice(0, 10).map((suite) => (
                      <tr key={suite.suiteId} className="border-t border-slate-100">
                        <td className="max-w-40 truncate py-2 pr-3 text-slate-700" title={suiteNameById.get(suite.suiteId) ?? "Deleted test"}>
                          {suiteNameById.get(suite.suiteId) ?? "Deleted test"}
                        </td>
                        <td className="py-2 pr-3 text-slate-700">{suite.passRate}%</td>
                        <td className="py-2 pr-3 text-slate-700">{suite.totalRuns}</td>
                        <td className={`py-2 ${suite.streak.status === "failed" ? "text-red-700" : "text-emerald-700"}`}>
                          {suite.streak.count} {suite.streak.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            <div className="rounded border border-slate-100 p-3">
              <h4 className="text-sm font-medium text-slate-800">Model breakdown</h4>
              {analytics.models.length === 0 ? (
                <p className="mt-2 text-xs text-slate-500">Model statistics appear after saved tests run.</p>
              ) : (
                <div className="mt-2 space-y-2">
                  {analytics.models.map((model) => (
                    <div key={model.name} className="flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate text-slate-700" title={model.name}>{model.name}</span>
                      <span className="shrink-0 text-slate-600">{model.passRate}% · {model.passedRuns}/{model.totalRuns} passed</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <p className="text-[11px] text-slate-500">
            Trend compares the newest up to 10 runs with the immediately preceding equally sized window. Invalid or older-format check/trace data is excluded from those specific metrics.
          </p>
          {(loadedRuns.length > 0 || hasMoreRuns) && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <p className="text-xs text-slate-500">
                Loaded {loadedRuns.length} run records; analytics update as older pages are loaded.
              </p>
              {hasMoreRuns && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={loadingMoreRuns || !workspaceId}
                  onClick={loadOlderRuns}
                >
                  {loadingMoreRuns ? "Loading…" : "Load older runs"}
                </Button>
              )}
              {historyError && <p role="alert" className="w-full text-xs text-red-700">{historyError}</p>}
            </div>
          )}
        </section>

        {suites.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-800">Saved tests</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={runAllSuites}
                disabled={runningSuiteId !== null || isPending}
              >
                <Play className="h-4 w-4" />
                Run all ({suites.reduce((total, suite) => total + suite.test_cases.length, 0)} cases)
              </Button>
            </div>
            {batchProgress && (
              <div role="status" aria-live="polite" className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">
                    Batch run: {batchProgress.completed}/{batchProgress.total} complete
                    {batchProgress.currentSuiteName ? ` · Running ${batchProgress.currentSuiteName}` : ""}
                  </p>
                  {runningSuiteId && !batchProgress.stopping && (
                    <Button type="button" size="sm" variant="outline" onClick={stopBatchAfterCurrent}>
                      Stop after current
                    </Button>
                  )}
                  {batchProgress.stopping && <span className="text-xs text-slate-500">Stopping after this test…</span>}
                </div>
                <p className="text-xs text-slate-600">
                  {batchProgress.results.filter((result) => result.status === "passed").length} passed ·{" "}
                  {batchProgress.results.filter((result) => result.status === "failed").length} failed ·{" "}
                  {batchProgress.results.filter((result) => result.status === "error").length} errors
                  {batchProgress.completed < batchProgress.total && !runningSuiteId && " · Remaining tests were not run"}
                </p>
                {batchProgress.results.length > 0 && (
                  <ul className="space-y-1">
                    {batchProgress.results.map((result) => (
                      <li key={`${result.suiteId}-${result.caseIndex}`} className="flex flex-wrap justify-between gap-2 text-xs">
                        <span className="text-slate-700">{result.suiteName} / {result.caseName}</span>
                        <span className={
                          result.status === "passed" ? "text-emerald-700" :
                            result.status === "failed" ? "text-red-700" : "text-amber-700"
                        }>
                          {result.status}{result.error ? `: ${result.error}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {suites.map((suite) => {
              const suiteRuns = recentRunsBySuiteId.get(suite.id) ?? [];
              const latestRun = suiteRuns[0];
              const previousRun = latestRun
                ? suiteRuns.find((run) =>
                    run.test_case_index === latestRun.test_case_index && run.id !== latestRun.id
                  )
                : undefined;
              const latestTrace = latestRun ? readRunTrace(latestRun.trace) : null;
              const previousTrace = previousRun ? readRunTrace(previousRun.trace) : null;
              const traceDifferences =
                latestTrace && previousTrace ? compareRunTraces(previousTrace, latestTrace) : null;
              return (
                <article key={suite.id} className="rounded-md border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="font-medium text-slate-900">{suite.name}</h4>
                      <p className="mt-1 text-xs text-slate-500">{suite.test_cases.length} saved test case{suite.test_cases.length === 1 ? "" : "s"}</p>
                      <ul className="mt-2 space-y-1">
                        {suite.test_cases.map((testCase, index) => (
                          <li key={`${index}-${testCase.name}`} className="text-sm text-slate-600">
                            <span className="font-medium">{testCase.name}:</span>{" "}
                            <span className="whitespace-pre-wrap">{testCase.prompt}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-slate-500">
                        Tools: {suite.tool_ids.map((id) => toolById.get(id)?.name ?? "Deleted tool").join(", ")}
                      </p>
                      {readResponseAssertionSummaries(suite.response_assertions, toolById).map((assertion, index) => (
                        <p key={`assertion-${index}`} className="text-xs text-slate-500">Response check: {assertion}</p>
                      ))}
                      {suite.expected_tool_ids !== null && (
                        <p className="text-xs text-slate-500">
                          Expected sequence: {suite.expected_tool_ids.map((id) => toolById.get(id)?.name ?? "Deleted tool").join(" → ") || "(no calls)"}
                        </p>
                      )}
                      {suite.required_answer_text.length > 0 && (
                        <p className="text-xs text-slate-500">Required phrases: {suite.required_answer_text.join(", ")}</p>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" onClick={() => runSuite(suite.id)} disabled={runningSuiteId !== null || isPending}>
                        <Play className="h-4 w-4" />
                        {runningSuiteId === suite.id ? "Running…" : "Run"}
                      </Button>
                      <Button type="button" variant="destructive" size="icon" aria-label={`Delete ${suite.name}`} disabled={runningSuiteId !== null || isPending} onClick={() => removeSuite(suite.id, suite.name)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {runResults[suite.id] && renderResult(runResults[suite.id])}
                  {runErrors[suite.id] && <p role="alert" className="mt-3 text-sm text-red-700">{runErrors[suite.id]}</p>}
                  {!runResults[suite.id] && latestRun && (
                    <div className="mt-3 border-t border-slate-100 pt-2">
                      <p className={`text-sm font-medium ${latestRun.status === "passed" ? "text-emerald-700" : "text-red-700"}`}>
                        Latest run ({latestRun.test_case_name}): {latestRun.status} · {new Date(latestRun.created_at).toLocaleString()}
                      </p>
                      <p className="truncate text-xs text-slate-500">Run ID: {latestRun.run_id}</p>
                    </div>
                  )}
                  {latestRun && (
                    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                      <h5 className="text-sm font-medium text-slate-800">Run trace</h5>
                      {latestTrace ? (
                        <details className="rounded border border-slate-200 p-3">
                          <summary className="cursor-pointer text-sm text-slate-700">
                            {latestTrace.calls.length} tool call{latestTrace.calls.length === 1 ? "" : "s"} · {latestRun.model}
                          </summary>
                          <div className="mt-3 space-y-3">
                            {latestTrace.calls.map((call, index) => (
                              <div key={`${call.toolId}-${index}`} className="rounded bg-slate-50 p-3 text-xs">
                                <p className="font-medium text-slate-800">
                                  {index + 1}. {call.toolName} · HTTP {call.status}
                                </p>
                                <p className="mt-2 font-medium text-slate-600">Arguments</p>
                                <pre className="overflow-x-auto whitespace-pre-wrap break-all">{call.arguments}</pre>
                                <p className="mt-2 font-medium text-slate-600">Response</p>
                                <pre className="overflow-x-auto whitespace-pre-wrap break-all">{call.response}</pre>
                              </div>
                            ))}
                            <div className="rounded bg-slate-50 p-3 text-xs">
                              <p className="font-medium text-slate-600">Final answer</p>
                              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap">{latestTrace.answer}</pre>
                            </div>
                          </div>
                        </details>
                      ) : (
                        <p className="text-xs text-slate-500">Trace unavailable. Run this test again to capture one.</p>
                      )}
                      {previousRun && (
                        <div className="rounded border border-slate-200 p-3">
                          <p className="text-sm font-medium text-slate-800">Compared with previous {latestRun.test_case_name} run</p>
                          {traceDifferences ? (
                            traceDifferences.length === 0 ? (
                              <p className="mt-2 text-xs text-emerald-700">No trace differences detected.</p>
                            ) : (
                              <ul className="mt-2 space-y-2">
                                {traceDifferences.map((difference, index) => (
                                  <li key={`${difference.label}-${index}`} className="grid gap-1 text-xs sm:grid-cols-[9rem_1fr_1fr]">
                                    <span className="font-medium text-slate-700">{difference.label}</span>
                                    <span className="line-clamp-4 break-all text-slate-500"><strong>Previous:</strong> {difference.before}</span>
                                    <span className="line-clamp-4 break-all text-slate-700"><strong>Latest:</strong> {difference.after}</span>
                                  </li>
                                ))}
                              </ul>
                            )
                          ) : (
                            <p className="mt-2 text-xs text-slate-500">Comparison is available after both runs have trace data.</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        )}
        {error && selectableTools.length === 0 && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {notice && selectableTools.length === 0 && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      </CardContent>
    </Card>
  );
}
