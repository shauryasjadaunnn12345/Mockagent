"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, GitBranch, Lightbulb, Play, Plus, RotateCcw, Sparkles, Trash2 } from "lucide-react";
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
  createCoverageImprovement,
  DEFAULT_AUTO_IMPROVE_ROUNDS,
  parseAutoImproveRoundLimit,
  shouldContinueAutoImprove,
  type AutoImproveRoundLimit,
  type CoverageImprovement,
} from "@/lib/auto-improve";
import {
  MAX_REGRESSION_TEST_CASES,
  isResponseAssertionOperator,
  parseRegressionTestCases,
  parseRegressionResponseAssertions,
  type RegressionResponseAssertion,
  type RegressionTestCase,
} from "@/lib/regression-suites";
import { analyzeRegressionRuns } from "@/lib/regression-analytics";
import { analyzeRegressionCoverage } from "@/lib/regression-coverage";
import {
  createRegressionSuiteBundle,
  MAX_REGRESSION_SUITE_BUNDLE_BYTES,
  mapImportedRegressionSuiteTools,
  parseRegressionSuiteBundle,
} from "@/lib/regression-suite-io";
import {
  parseRegressionContractReview,
  parseRegressionFailureExplanation,
  type RegressionContractFinding,
  type RegressionContractReview,
} from "@/lib/regression-ai";
import type { Json } from "@/types/database";
import {
  DEMO_CORRECTED_AGENT_PROMPT,
  DEMO_FAILED_CHECK,
  DEMO_FLAWED_AGENT_PROMPT,
  DEMO_TOOLS,
  measureDemoCoverage,
  runCorrectedDemoAgent,
  runFlawedDemoAgent,
  type DemoRun,
} from "@/lib/demo-mode";

export interface RegressionToolOption {
  id: string;
  name: string;
  is_active: boolean;
  require_api_key: boolean;
  json_schema: Json;
  scenarios: Json;
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
  semantic_criteria: string | null;
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
  prompt_snapshot: string | null;
  branch_from_run_id: string | null;
  created_at: string;
}

interface ReplayOutcome {
  runId: string;
  model: string;
  passed: boolean;
  trace: RunTrace;
  differences: ReturnType<typeof compareRunTraces>;
}

interface AutoImproveStep extends CoverageImprovement {
  suiteName: string;
  caseCount: number;
  passedCount: number;
  failedCount: number;
}

interface AutoImproveProgress {
  sourceSuiteId: string;
  sourceSuiteName: string;
  toolIds: string[];
  maxRounds: AutoImproveRoundLimit;
  baselineBefore: number;
  baselineAfter: number;
  baselinePassed: number;
  baselineFailed: number;
  currentCoverage: number;
  rounds: AutoImproveStep[];
  draftRound: number | null;
  draftCases: RegressionTestCase[];
  draftModel: string | null;
  runs: Array<{ trace: unknown }>;
  status: "running" | "review" | "complete" | "error";
  message: string | null;
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

interface FailureExplanation {
  summary: string;
  findings: Array<{
    checkName: string;
    explanation: string;
    suggestedAction: string;
  }>;
}

interface DemoProgress {
  status: "analyzing" | "review" | "rerunning" | "complete" | "error";
  flawedRun: DemoRun;
  coverageBefore: number;
  explanation: FailureExplanation | null;
  draftCases: RegressionTestCase[];
  savedCases: RegressionTestCase[];
  correctedRun: DemoRun | null;
  coverageAfter: number | null;
  model: string | null;
  aiUsage: { used: number; limit: number } | null;
  error: string | null;
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
  const metadata = isRecord(value.metadata) &&
    typeof value.metadata.model === "string" &&
    typeof value.metadata.provider === "string" &&
    typeof value.metadata.reasoningReplay === "boolean"
    ? {
        model: value.metadata.model,
        provider: value.metadata.provider,
        reasoningReplay: value.metadata.reasoningReplay,
      }
    : undefined;
  return { answer: value.answer, calls, ...(metadata ? { metadata } : {}) };
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
  const [generationHint, setGenerationHint] = useState("");
  const [generatingCases, setGeneratingCases] = useState(false);
  const [reviewingContracts, setReviewingContracts] = useState(false);
  const [contractReview, setContractReview] = useState<RegressionContractReview | null>(null);
  const [contractReviewModel, setContractReviewModel] = useState<string | null>(null);
  const [contractReviewError, setContractReviewError] = useState<string | null>(null);
  const [selectedToolIds, setSelectedToolIds] = useState<string[]>([]);
  const [checksToolSequence, setChecksToolSequence] = useState(false);
  const [expectedToolIds, setExpectedToolIds] = useState<string[]>([]);
  const [expectedToolToAdd, setExpectedToolToAdd] = useState("");
  const [requiredText, setRequiredText] = useState("");
  const [semanticCriteria, setSemanticCriteria] = useState("");
  const [toolApiKeys, setToolApiKeys] = useState<Record<string, string>>({});
  const [responseAssertions, setResponseAssertions] = useState<RegressionResponseAssertion[]>([]);
  const [assertionToolId, setAssertionToolId] = useState("");
  const [assertionPath, setAssertionPath] = useState("");
  const [assertionOperator, setAssertionOperator] = useState<RegressionResponseAssertion["operator"]>("equals");
  const [assertionScope, setAssertionScope] = useState<RegressionResponseAssertion["scope"]>("first");
  const [assertionExpected, setAssertionExpected] = useState('""');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [suiteTransferError, setSuiteTransferError] = useState<string | null>(null);
  const [suiteTransferNotice, setSuiteTransferNotice] = useState<string | null>(null);
  const [runningSuiteId, setRunningSuiteId] = useState<string | null>(null);
  const [runResults, setRunResults] = useState<Record<string, RegressionResult>>({});
  const [runErrors, setRunErrors] = useState<Record<string, string>>({});
  const [batchProgress, setBatchProgress] = useState<BatchProgress | null>(null);
  const [loadedRuns, setLoadedRuns] = useState(recentRuns);
  const [hasMoreRuns, setHasMoreRuns] = useState(initialHasMoreRuns);
  const [loadingMoreRuns, setLoadingMoreRuns] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [replayRunId, setReplayRunId] = useState<string | null>(null);
  const [branchDraftRunId, setBranchDraftRunId] = useState<string | null>(null);
  const [branchPrompts, setBranchPrompts] = useState<Record<string, string>>({});
  const [branchModels, setBranchModels] = useState<Record<string, string>>({});
  const [replayOutcomes, setReplayOutcomes] = useState<Record<string, ReplayOutcome>>({});
  const [replayErrors, setReplayErrors] = useState<Record<string, string>>({});
  const [failureExplanations, setFailureExplanations] = useState<Record<string, FailureExplanation>>({});
  const [explainingRunId, setExplainingRunId] = useState<string | null>(null);
  const [explanationErrors, setExplanationErrors] = useState<Record<string, string>>({});
  const [followupDrafts, setFollowupDrafts] = useState<Record<string, RegressionTestCase[]>>({});
  const [followupErrors, setFollowupErrors] = useState<Record<string, string>>({});
  const [followupLoadingRunId, setFollowupLoadingRunId] = useState<string | null>(null);
  const [savingFollowupRunId, setSavingFollowupRunId] = useState<string | null>(null);
  const [autoImproveRoundLimit, setAutoImproveRoundLimit] = useState<AutoImproveRoundLimit>(DEFAULT_AUTO_IMPROVE_ROUNDS);
  const [autoImprove, setAutoImprove] = useState<AutoImproveProgress | null>(null);
  const [demo, setDemo] = useState<DemoProgress | null>(null);
  const [pendingImport, setPendingImport] = useState<ReturnType<typeof parseRegressionSuiteBundle> | null>(null);
  const [importToolMappings, setImportToolMappings] = useState<Record<string, string>>({});
  const [importing, setImporting] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const stopBatchRef = useRef(false);
  const [isPending, startTransition] = useTransition();
  const selectableTools = tools.filter((tool) => tool.is_active);
  const credentialToolIds = [...new Set([
    ...selectedToolIds,
    ...suites.flatMap((suite) => suite.tool_ids),
  ])];
  const toolById = new Map(tools.map((tool) => [tool.id, tool]));
  const analytics = analyzeRegressionRuns(loadedRuns);
  const coverage = analyzeRegressionCoverage(tools, loadedRuns);
  const suiteNameById = new Map(suites.map((suite) => [suite.id, suite.name]));
  const recentRunsBySuiteId = new Map<string, RegressionRunOption[]>();
  for (const run of loadedRuns) {
    const suiteRuns = recentRunsBySuiteId.get(run.suite_id) ?? [];
    suiteRuns.push(run);
    recentRunsBySuiteId.set(run.suite_id, suiteRuns);
  }

  async function readSuiteImport(file: File | undefined) {
    if (!file) return;
    setSuiteTransferError(null);
    setSuiteTransferNotice(null);
    if (file.size > MAX_REGRESSION_SUITE_BUNDLE_BYTES) {
      setPendingImport(null);
      setSuiteTransferError("Import file must be 10 MB or smaller.");
      return;
    }
    try {
      const imported = parseRegressionSuiteBundle(await file.text());
      const names = [...new Set(imported.flatMap((item) => [
        ...item.toolNames,
        ...(item.expectedToolNames ?? []),
        ...item.suite.responseAssertions.map((assertion) => assertion.toolId),
      ]))];
      const defaults: Record<string, string> = {};
      for (const externalName of names) {
        const exactMatch = selectableTools.find((tool) => tool.name === externalName);
        if (exactMatch) defaults[externalName] = exactMatch.id;
      }
      setPendingImport(imported);
      setImportToolMappings(defaults);
      setSuiteTransferNotice(`Validated ${imported.length} suite${imported.length === 1 ? "" : "s"}. Map exported tool names to this workspace before importing.`);
    } catch (cause) {
      setPendingImport(null);
      setSuiteTransferError(cause instanceof Error ? cause.message : "Could not read the regression suite export.");
    }
  }

  function exportSuites() {
    setSuiteTransferError(null);
    setSuiteTransferNotice(null);
    try {
      const bundle = createRegressionSuiteBundle(suites.map((suite) => {
        const nameFor = (id: string) => {
          const toolName = toolById.get(id)?.name;
          if (!toolName) throw new Error(`Cannot export "${suite.name}": a referenced tool was deleted.`);
          return toolName;
        };
        const assertions = Array.isArray(suite.response_assertions)
          ? suite.response_assertions.map((assertion) => {
              if (!isRecord(assertion) || typeof assertion.toolId !== "string") {
                throw new Error(`Cannot export "${suite.name}": a response assertion is invalid.`);
              }
              return { ...assertion, toolId: nameFor(assertion.toolId) };
            })
          : [];
        return {
          name: suite.name,
          prompt: suite.prompt,
          testCases: suite.test_cases,
          toolNames: suite.tool_ids.map(nameFor),
          expectedToolNames: suite.expected_tool_ids?.map(nameFor) ?? null,
          requiredAnswerText: suite.required_answer_text,
          responseAssertions: assertions,
          semanticCriteria: suite.semantic_criteria,
        };
      }));
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "mockagent-regression-suites.json";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setSuiteTransferNotice(`Exported ${suites.length} regression suite${suites.length === 1 ? "" : "s"}. Tool references use names, not workspace IDs.`);
    } catch (cause) {
      setSuiteTransferError(cause instanceof Error ? cause.message : "Could not export regression suites.");
    }
  }

  async function importSuites() {
    if (!pendingImport) return;
    const externalNames = [...new Set(pendingImport.flatMap((item) => [
      ...item.toolNames,
      ...(item.expectedToolNames ?? []),
      ...item.suite.responseAssertions.map((assertion) => assertion.toolId),
    ]))];
    if (externalNames.some((externalName) => !importToolMappings[externalName])) {
      setSuiteTransferError("Map every exported tool name to an active tool in this workspace.");
      return;
    }
    setSuiteTransferError(null);
    setSuiteTransferNotice(null);
    setImporting(true);
    const failures: string[] = [];
    let importedCount = 0;
    for (const item of pendingImport) {
      try {
        const result = await createRegressionSuite(mapImportedRegressionSuiteTools(item, importToolMappings));
        if (result.success) importedCount += 1;
        else failures.push(`${item.suite.name}: ${result.error}`);
      } catch (cause) {
        failures.push(`${item.suite.name}: ${cause instanceof Error ? cause.message : "The import request failed."}`);
      }
    }
    setImporting(false);
    setPendingImport(null);
    if (failures.length) {
      setSuiteTransferError(`${importedCount} suite${importedCount === 1 ? "" : "s"} imported. ${failures.join(" ")}`);
    } else {
      setSuiteTransferNotice(`Imported ${importedCount} regression suite${importedCount === 1 ? "" : "s"}.`);
    }
    if (importedCount > 0) router.refresh();
  }

  function addTestCase() {
    if (testCases.length >= MAX_REGRESSION_TEST_CASES) return;
    let number = testCases.length + 1;
    while (testCases.some((testCase) => testCase.name.trim().toLocaleLowerCase() === `case ${number}`)) {
      number += 1;
    }
    setTestCases((current) => [...current, { name: `Case ${number}`, prompt: "" }]);
  }

  async function generateCases(
    sourceRunRecordId?: string,
    sourceToolIds: string[] = selectedToolIds,
    sourceSuiteName?: string,
    coverageGuided = false,
  ) {
    setError(null);
    setNotice(null);
    if (sourceToolIds.length === 0) {
      setError("Select at least one tool before generating regression cases.");
      return;
    }
    const existingCases = testCases.length === 1 && !testCases[0].prompt.trim()
      ? []
      : testCases;
    const remaining = MAX_REGRESSION_TEST_CASES - existingCases.length;
    if (remaining <= 0) {
      setError(`A regression test can have at most ${MAX_REGRESSION_TEST_CASES} cases.`);
      return;
    }

    setGeneratingCases(true);
    try {
      const response = await fetch("/api/regression/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolIds: sourceToolIds,
          hint: generationHint,
          coverageGuided,
          ...(sourceRunRecordId ? { runRecordId: sourceRunRecordId } : {}),
        }),
      });
      const body: unknown = await response.json();
      const record = isRecord(body) ? body : {};
      if (!response.ok) {
        throw new Error(typeof record.error === "string" ? record.error : "Could not generate test cases.");
      }
      const generatedCases = parseRegressionTestCases(record.testCases);
      const additions = generatedCases.slice(0, remaining);
      const existingNames = new Set(existingCases.map((testCase) => testCase.name.toLocaleLowerCase()));
      const uniqueAdditions = additions.map((testCase) => {
        let name = testCase.name;
        let suffix = 2;
        while (existingNames.has(name.toLocaleLowerCase())) {
          name = `${testCase.name.slice(0, 70)} ${suffix}`;
          suffix += 1;
        }
        existingNames.add(name.toLocaleLowerCase());
        return { ...testCase, name };
      });
      const combined = parseRegressionTestCases([...existingCases, ...uniqueAdditions]);
      setTestCases(combined);
      if (sourceRunRecordId) {
        setSelectedToolIds(sourceToolIds);
        if (sourceSuiteName && !name.trim()) {
          setName(`${sourceSuiteName} follow-up`.slice(0, 80));
        }
      }
      const model = typeof record.model === "string" ? ` with ${record.model}` : "";
      const source = sourceRunRecordId ? " from the failed run" : "";
      const coverageTargetCount = typeof record.coverageTargetCount === "number"
        ? record.coverageTargetCount
        : 0;
      const coverageNote = coverageGuided
        ? coverageTargetCount > 0
          ? ` targeting ${coverageTargetCount} uncovered coverage point${coverageTargetCount === 1 ? "" : "s"}`
          : " (no uncovered points were found in the latest 100 saved runs)"
        : "";
      setNotice(`Added ${uniqueAdditions.length} AI-generated case${uniqueAdditions.length === 1 ? "" : "s"}${source}${coverageNote}${model}. Review and edit them before saving.`);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "Could not generate test cases.");
    } finally {
      setGeneratingCases(false);
    }
  }

  async function reviewSelectedContracts() {
    setContractReviewError(null);
    setContractReview(null);
    setContractReviewModel(null);
    if (selectedToolIds.length === 0) {
      setContractReviewError("Select at least one tool before reviewing its contract.");
      return;
    }

    setReviewingContracts(true);
    try {
      const response = await fetch("/api/regression/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolIds: selectedToolIds,
          hint: generationHint,
          coverageGuided: true,
          contractReview: true,
        }),
      });
      const body: unknown = await response.json();
      const record = isRecord(body) ? body : {};
      if (!response.ok) {
        throw new Error(typeof record.error === "string" ? record.error : "Could not review tool contracts.");
      }
      const review = parseRegressionContractReview(
        record.review,
        tools.filter((tool) => selectedToolIds.includes(tool.id)).map((tool) => tool.name),
      );
      setContractReview(review);
      setContractReviewModel(typeof record.model === "string" ? record.model : null);
      setNotice(`Meta reviewed ${selectedToolIds.length} selected tool contract${selectedToolIds.length === 1 ? "" : "s"}${typeof record.coverageTargetCount === "number" ? ` against ${record.coverageTargetCount} uncovered coverage point${record.coverageTargetCount === 1 ? "" : "s"}` : ""}. Review findings before creating tests.`);
    } catch (reviewError) {
      setContractReviewError(reviewError instanceof Error ? reviewError.message : "Could not review tool contracts.");
    } finally {
      setReviewingContracts(false);
    }
  }

  function addContractFinding(finding: RegressionContractFinding, index: number) {
    if (testCases.length >= MAX_REGRESSION_TEST_CASES) {
      setError(`A regression test can have at most ${MAX_REGRESSION_TEST_CASES} cases.`);
      return;
    }
    const baseName = `${finding.toolName} risk ${index + 1}`.slice(0, 80);
    const names = new Set(testCases.map((testCase) => testCase.name.toLocaleLowerCase()));
    let caseName = baseName;
    let suffix = 2;
    while (names.has(caseName.toLocaleLowerCase())) {
      caseName = `${baseName.slice(0, 70)} ${suffix}`;
      suffix += 1;
    }
    try {
      setTestCases(parseRegressionTestCases([
        ...testCases,
        { name: caseName, prompt: finding.testPrompt },
      ]));
      setNotice(`Added a draft case for the ${finding.severity}-severity ${finding.area} risk. Review it before saving.`);
    } catch (caseError) {
      setError(caseError instanceof Error ? caseError.message : "Could not add the suggested test case.");
    }
  }

  function toggleTool(toolId: string) {
    if (selectedToolIds.includes(toolId)) {
      setSelectedToolIds((current) => current.filter((id) => id !== toolId));
      setToolApiKeys((current) => {
        const next = { ...current };
        delete next[toolId];
        return next;
      });
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
    if (!expectedToolToAdd) return;
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
        scope: assertionScope,
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
        semanticCriteria,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setName("");
      setTestCases([{ name: "Case 1", prompt: "" }]);
      setRequiredText("");
      setSemanticCriteria("");
      setResponseAssertions([]);
      setExpectedToolIds([]);
      setChecksToolSequence(false);
      setNotice("Regression test saved.");
      router.refresh();
    });
  }

  function getApiKeysForTools(toolIds: string[]): Record<string, string> {
    return Object.fromEntries(
      toolIds
        .filter((toolId) => toolById.get(toolId)?.require_api_key && toolApiKeys[toolId])
        .map((toolId) => [toolId, toolApiKeys[toolId]])
    );
  }

  function getMissingApiKey(toolIds: string[]): RegressionToolOption | undefined {
    return toolIds
      .map((toolId) => toolById.get(toolId))
      .find((tool): tool is RegressionToolOption =>
        Boolean(tool?.require_api_key && !toolApiKeys[tool.id]?.trim())
      );
  }

  async function executeSuite(
    suiteId: string,
    caseIndex: number,
    apiKeys: Record<string, string>,
    options: { promptOverride?: string; model?: string; branchFromRunId?: string } = {}
  ): Promise<{ regression: RegressionResult | null; error: string | null; trace: RunTrace | null; runId: string | null; model: string | null }> {
    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          suiteId,
          caseIndex,
          apiKeys,
          ...(options.promptOverride === undefined ? {} : { promptOverride: options.promptOverride }),
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.branchFromRunId === undefined ? {} : { branchFromRunId: options.branchFromRunId }),
        }),
      });
      const body: unknown = await response.json();
      const responseBody = isRecord(body) ? body : {};
      const regression = readRegressionResult(responseBody.regression);
      const trace = readRunTrace(responseBody.trace);
      const runId = typeof responseBody.runId === "string" ? responseBody.runId : null;
      const model = typeof responseBody.model === "string" ? responseBody.model : null;
      if (!response.ok) {
        return {
          regression: null,
          error: typeof responseBody.error === "string" ? responseBody.error : "Regression test run failed.",
          trace,
          runId,
          model,
        };
      }
      if (!regression) {
        return { regression: null, error: "Regression test completed without a valid result.", trace, runId, model };
      }
      return { regression, error: null, trace, runId, model };
    } catch (requestError) {
      return {
        regression: null,
        error: requestError instanceof Error ? requestError.message : "Regression test run failed.",
        trace: null,
        runId: null,
        model: null,
      };
    }
  }

  function getPromptForRun(run: RegressionRunOption, suite: RegressionSuiteOption): string {
    return run.prompt_snapshot ?? suite.test_cases[run.test_case_index]?.prompt ?? "";
  }

  function clearReplayError(runId: string) {
    setReplayErrors((current) => {
      const next = { ...current };
      delete next[runId];
      return next;
    });
  }

  async function replaySavedRun(run: RegressionRunOption, suite: RegressionSuiteOption, branch: boolean) {
    clearReplayError(run.id);
    const prompt = branch ? branchPrompts[run.id] ?? getPromptForRun(run, suite) : getPromptForRun(run, suite);
    if (!prompt.trim()) {
      setReplayErrors((current) => ({ ...current, [run.id]: "This older run has no saved prompt. Re-run the saved case to capture a replayable snapshot." }));
      return;
    }
    if (branch && !branchModels[run.id]?.trim()) {
      setReplayErrors((current) => ({ ...current, [run.id]: "Enter a model name for the branch." }));
      return;
    }
    const missingApiKey = getMissingApiKey(suite.tool_ids);
    if (missingApiKey) {
      setReplayErrors((current) => ({ ...current, [run.id]: `Enter the API key for "${missingApiKey.name}" before replaying this run.` }));
      return;
    }
    setReplayRunId(run.id);
    try {
      const outcome = await executeSuite(
        suite.id,
        run.test_case_index,
        getApiKeysForTools(suite.tool_ids),
        {
          promptOverride: prompt,
          model: branch ? branchModels[run.id].trim() : run.model,
          ...(branch ? { branchFromRunId: run.id } : {}),
        },
      );
      if (!outcome.regression || !outcome.trace || !outcome.runId || !outcome.model) {
        throw new Error(outcome.error ?? "Replay completed without a comparable run trace.");
      }
      const originalTrace = readRunTrace(run.trace);
      if (!originalTrace) throw new Error("The source run has no valid trace to compare.");
      setReplayOutcomes((current) => ({
        ...current,
        [run.id]: {
          runId: outcome.runId!,
          model: outcome.model!,
          passed: outcome.regression!.passed,
          trace: outcome.trace!,
          differences: compareRunTraces(originalTrace, outcome.trace!),
        },
      }));
      clearReplayError(run.id);
      setBranchDraftRunId(null);
      router.refresh();
    } catch (replayError) {
      setReplayErrors((current) => ({
        ...current,
        [run.id]: replayError instanceof Error ? replayError.message : "Could not replay this run.",
      }));
    } finally {
      setReplayRunId(null);
    }
  }

  function getCoverageForSuite(suite: RegressionSuiteOption, additionalRuns: Array<{ trace: unknown }> = []) {
    const selectedTools = tools
      .filter((tool) => suite.tool_ids.includes(tool.id))
      .map(({ id, name, json_schema, scenarios }) => ({ id, name, json_schema, scenarios }));
    return analyzeRegressionCoverage(selectedTools, [
      ...loadedRuns.slice(0, 100).reverse().map((run) => ({ trace: run.trace })),
      ...additionalRuns,
    ].slice(-100));
  }

  async function requestAutoImproveDraft(
    progress: AutoImproveProgress,
    round: number,
    measuredCoverage: ReturnType<typeof getCoverageForSuite>,
  ) {
    if (measuredCoverage.gaps.length === 0) {
      setAutoImprove({ ...progress, status: "complete", draftRound: null, message: "All configured coverage points are covered." });
      return;
    }

    setAutoImprove({ ...progress, status: "running", draftRound: null, message: `Asking Meta to target ${measuredCoverage.gaps.length} remaining coverage points…` });
    try {
      const targets = measuredCoverage.gaps.slice(0, 12).map((gap) => `${gap.toolName}: ${gap.target}`).join("; ");
      const response = await fetch("/api/regression/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolIds: progress.toolIds,
          hint: `Auto-improve round ${round} of ${progress.maxRounds}. Prioritize these uncovered points: ${targets}`.slice(0, 1000),
          coverageGuided: true,
        }),
      });
      const body: unknown = await response.json();
      const record = isRecord(body) ? body : {};
      if (!response.ok) {
        throw new Error(typeof record.error === "string" ? record.error : "Could not generate the next coverage draft.");
      }
      const draftCases = parseRegressionTestCases(record.testCases);
      if (draftCases.length === 0) throw new Error("Meta returned no valid regression cases for the remaining coverage.");
      setAutoImprove({
        ...progress,
        status: "review",
        draftRound: round,
        draftCases,
        draftModel: typeof record.model === "string" ? record.model : null,
        message: `Review and edit this draft. It will not be saved or run until you confirm.`,
      });
    } catch (draftError) {
      setAutoImprove({
        ...progress,
        status: "error",
        draftRound: null,
        message: draftError instanceof Error ? draftError.message : "Could not generate the next coverage draft.",
      });
    }
  }

  async function startAutoImprove(suite: RegressionSuiteOption) {
    setError(null);
    setNotice(null);
    const missingApiKey = getMissingApiKey(suite.tool_ids);
    if (missingApiKey) {
      setError(`Enter the API key for "${missingApiKey.name}" before running this test.`);
      return;
    }
    if (suite.tool_ids.length === 0 || suite.test_cases.length === 0) {
      setError("This regression test needs at least one tool and one case before auto-improving coverage.");
      return;
    }
    const selectedRoundLimit = parseAutoImproveRoundLimit(autoImproveRoundLimit);
    const baselineCoverage = getCoverageForSuite(suite).percentage;
    const initialProgress: AutoImproveProgress = {
      sourceSuiteId: suite.id,
      sourceSuiteName: suite.name,
      toolIds: suite.tool_ids,
      maxRounds: selectedRoundLimit,
      baselineBefore: baselineCoverage,
      baselineAfter: baselineCoverage,
      baselinePassed: 0,
      baselineFailed: 0,
      currentCoverage: baselineCoverage,
      rounds: [],
      draftRound: null,
      draftCases: [],
      draftModel: null,
      runs: [],
      status: "running",
      message: "Running the saved baseline cases…",
    };
    setAutoImprove(initialProgress);
    setRunningSuiteId(suite.id);

    const traces: Array<{ trace: unknown }> = [];
    const errors: string[] = [];
    let baselinePassed = 0;
    let baselineFailed = 0;
    const apiKeys = getApiKeysForTools(suite.tool_ids);
    for (let caseIndex = 0; caseIndex < suite.test_cases.length; caseIndex += 1) {
      const outcome = await executeSuite(suite.id, caseIndex, apiKeys);
      if (outcome.trace) traces.push({ trace: outcome.trace });
      if (outcome.error) errors.push(`${suite.test_cases[caseIndex].name}: ${outcome.error}`);
      else if (outcome.regression?.passed) baselinePassed += 1;
      else if (outcome.regression) baselineFailed += 1;
    }
    setRunningSuiteId(null);
    const baselineAfter = getCoverageForSuite(suite, traces).percentage;
    const progress: AutoImproveProgress = {
      ...initialProgress,
      baselineAfter,
      baselinePassed,
      baselineFailed,
      currentCoverage: baselineAfter,
      runs: traces,
      status: errors.length ? "error" : "running",
      message: errors.length
        ? `Baseline execution stopped: ${errors.join(" ")}`
        : "Baseline complete. Measuring uncovered points…",
    };
    setAutoImprove(progress);
    router.refresh();
    if (errors.length) return;

    const measuredCoverage = getCoverageForSuite(suite, traces);
    if (!shouldContinueAutoImprove(0, selectedRoundLimit, measuredCoverage.gaps.length)) {
      setAutoImprove({ ...progress, status: "complete", message: "No uncovered coverage points remain." });
      return;
    }
    await requestAutoImproveDraft(progress, 1, measuredCoverage);
  }

  async function saveAndRunAutoImproveRound() {
    if (!autoImprove || autoImprove.status !== "review" || autoImprove.draftRound === null) return;
    const sourceSuite = suites.find((suite) => suite.id === autoImprove.sourceSuiteId);
    if (!sourceSuite) {
      setAutoImprove({ ...autoImprove, status: "error", message: "The source regression test is no longer available." });
      return;
    }
    const round = autoImprove.draftRound;
    setAutoImprove({ ...autoImprove, status: "running", message: `Saving your confirmed draft and running round ${round}…` });

    try {
      const draftCases = parseRegressionTestCases(autoImprove.draftCases);
      const draftName = `${sourceSuite.name} · coverage round ${round}`.slice(0, 80);
      const created = await createRegressionSuite({
        name: draftName,
        prompt: draftCases[0]?.prompt ?? "",
        testCases: draftCases,
        toolIds: sourceSuite.tool_ids,
        expectedToolIds: null,
        requiredAnswerText: [],
        responseAssertions: [],
        semanticCriteria: null,
      });
      if (!created.success) throw new Error(created.error);

      setRunningSuiteId(created.suiteId);
      const traces: Array<{ trace: unknown }> = [];
      const errors: string[] = [];
      let passedCount = 0;
      let failedCount = 0;
      const apiKeys = getApiKeysForTools(sourceSuite.tool_ids);
      for (let caseIndex = 0; caseIndex < draftCases.length; caseIndex += 1) {
        const outcome = await executeSuite(created.suiteId, caseIndex, apiKeys);
        if (outcome.trace) traces.push({ trace: outcome.trace });
        if (outcome.error) errors.push(`${draftCases[caseIndex].name}: ${outcome.error}`);
        else if (outcome.regression?.passed) passedCount += 1;
        else if (outcome.regression) failedCount += 1;
      }
      setRunningSuiteId(null);

      const allRuns = [...autoImprove.runs, ...traces];
      const measuredCoverage = getCoverageForSuite(sourceSuite, allRuns);
      const step: AutoImproveStep = {
        ...createCoverageImprovement(round, autoImprove.currentCoverage, measuredCoverage.percentage),
        suiteName: draftName,
        caseCount: draftCases.length,
        passedCount,
        failedCount,
      };
      const updated: AutoImproveProgress = {
        ...autoImprove,
        baselineAfter: autoImprove.baselineAfter,
        currentCoverage: measuredCoverage.percentage,
        rounds: [...autoImprove.rounds, step],
        draftRound: null,
        draftCases: [],
        draftModel: null,
        runs: allRuns,
        status: errors.length ? "error" : "running",
        message: errors.length
          ? `Round ${round} execution stopped: ${errors.join(" ")}`
          : `Round ${round} complete: ${passedCount} case${passedCount === 1 ? "" : "s"} passed${failedCount ? `, ${failedCount} failed` : ""}.`,
      };
      setAutoImprove(updated);
      router.refresh();
      if (errors.length) return;

      if (shouldContinueAutoImprove(round, autoImprove.maxRounds, measuredCoverage.gaps.length)) {
        await requestAutoImproveDraft(updated, round + 1, measuredCoverage);
      } else {
        setAutoImprove({
          ...updated,
          status: "complete",
          message: measuredCoverage.gaps.length === 0
            ? "All configured coverage points are covered."
            : `Reached the ${autoImprove.maxRounds}-round limit with ${measuredCoverage.gaps.length} coverage points still uncovered.`,
        });
      }
    } catch (saveError) {
      setRunningSuiteId(null);
      setAutoImprove({
        ...autoImprove,
        status: "error",
        message: saveError instanceof Error ? saveError.message : "Could not save and run the confirmed coverage draft.",
      });
    }
  }

  async function runDemo() {
    const flawedRun = runFlawedDemoAgent();
    const coverageBefore = measureDemoCoverage([flawedRun]).percentage;
    setDemo({
      status: "analyzing",
      flawedRun,
      coverageBefore,
      explanation: null,
      draftCases: [],
      savedCases: [],
      correctedRun: null,
      coverageAfter: null,
      model: null,
      aiUsage: null,
      error: null,
    });

    try {
      const response = await fetch("/api/demo", { method: "POST" });
      const body: unknown = await response.json();
      const record = isRecord(body) ? body : {};
      if (!response.ok) {
        throw new Error(typeof record.error === "string" ? record.error : "Could not complete the Meta demo review.");
      }
      const explanation = parseRegressionFailureExplanation(record.explanation, [DEMO_FAILED_CHECK]);
      const draftCases = parseRegressionTestCases(record.testCases);
      const usage = isRecord(record.aiUsage) &&
        typeof record.aiUsage.used === "number" &&
        typeof record.aiUsage.limit === "number"
        ? { used: record.aiUsage.used, limit: record.aiUsage.limit }
        : null;
      setDemo((current) => current
        ? {
            ...current,
            status: "review",
            explanation,
            draftCases,
            model: typeof record.model === "string" ? record.model : null,
            aiUsage: usage,
          }
        : current);
    } catch (demoError) {
      setDemo((current) => current
        ? {
            ...current,
            status: "error",
            error: demoError instanceof Error ? demoError.message : "Could not complete the Meta demo review.",
          }
        : current);
    }
  }

  function addDemoRegressionAndRerun() {
    if (!demo || demo.status !== "review" || demo.draftCases.length === 0) return;
    try {
      const savedCases = parseRegressionTestCases(demo.draftCases);
      const reruns = savedCases.map(() => runCorrectedDemoAgent());
      const coverageAfter = measureDemoCoverage([demo.flawedRun, ...reruns]).percentage;
      setDemo({
        ...demo,
        status: "complete",
        savedCases,
        correctedRun: reruns[0] ?? null,
        coverageAfter,
        error: null,
      });
    } catch (demoError) {
      setDemo({
        ...demo,
        status: "error",
        error: demoError instanceof Error ? demoError.message : "Could not add the reviewed demo regression case.",
      });
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
    const missingApiKey = getMissingApiKey(suite.tool_ids);
    if (missingApiKey) {
      setRunErrors((current) => ({ ...current, [suiteId]: `Enter the API key for "${missingApiKey.name}" before running this test.` }));
      setRunningSuiteId(null);
      return;
    }
    const apiKeys = getApiKeysForTools(suite.tool_ids);
    const checks: RegressionResult["checks"] = [];
    const errors: string[] = [];
    let allPassed = true;
    for (let caseIndex = 0; caseIndex < suite.test_cases.length; caseIndex += 1) {
      const testCase = suite.test_cases[caseIndex];
      const outcome = await executeSuite(suiteId, caseIndex, apiKeys);
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
    const requiredToolIds = [...new Set(suites.flatMap((suite) => suite.tool_ids))];
    const missingApiKey = getMissingApiKey(requiredToolIds);
    if (missingApiKey) {
      setError(`Enter the API key for "${missingApiKey.name}" before running all tests.`);
      return;
    }
    const totalCases = suites.reduce((total, suite) => total + suite.test_cases.length, 0);
    if (!confirm(
      `Run all ${totalCases} saved test cases sequentially? Each case can make multiple model requests and use your workspace AI quota.`
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

    let results: BatchRunResult[] = [];
    for (const suite of suites) {
      for (let caseIndex = 0; caseIndex < suite.test_cases.length; caseIndex += 1) {
        if (stopBatchRef.current) break;

        const testCase = suite.test_cases[caseIndex];
        setRunningSuiteId(suite.id);
        setBatchProgress((current) => current
          ? { ...current, currentSuiteName: `${suite.name} / ${testCase.name}` }
          : current);
        const outcome = await executeSuite(
          suite.id,
          caseIndex,
          getApiKeysForTools(suite.tool_ids)
        );

        const result: BatchRunResult = {
          suiteId: suite.id,
          caseIndex,
          suiteName: suite.name,
          caseName: testCase.name,
          status: outcome.error ? "error" : outcome.regression?.passed ? "passed" : "failed",
          ...(outcome.error ? { error: outcome.error } : {}),
        };
        results = [...results, result];
        const updatedResults = results;
        setBatchProgress((current) => current
          ? { ...current, completed: current.completed + 1, results: updatedResults }
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

  async function explainFailure(runRecordId: string): Promise<FailureExplanation | null> {
    setExplainingRunId(runRecordId);
    setExplanationErrors((current) => {
      const next = { ...current };
      delete next[runRecordId];
      return next;
    });
    setFailureExplanations((current) => {
      const next = { ...current };
      delete next[runRecordId];
      return next;
    });
    try {
      const response = await fetch("/api/regression/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runRecordId }),
      });
      const body: unknown = await response.json();
      const record = isRecord(body) ? body : {};
      if (!response.ok) {
        throw new Error(typeof record.error === "string" ? record.error : "Could not explain this failure.");
      }
      const explanation = record.explanation;
      if (
        !isRecord(explanation) ||
        typeof explanation.summary !== "string" ||
        !Array.isArray(explanation.findings)
      ) {
        throw new Error("Failure explanation response was invalid.");
      }
      const summary = explanation.summary;
      const findings = explanation.findings.filter(
        (finding): finding is FailureExplanation["findings"][number] =>
          isRecord(finding) &&
          typeof finding.checkName === "string" &&
          typeof finding.explanation === "string" &&
          typeof finding.suggestedAction === "string",
      );
      if (findings.length !== explanation.findings.length || findings.length === 0) {
        throw new Error("Failure explanation did not include valid evidence-linked findings.");
      }
      const result = { summary, findings };
      setFailureExplanations((current) => ({
        ...current,
        [runRecordId]: result,
      }));
      return result;
    } catch (explanationError) {
      setExplanationErrors((current) => ({
        ...current,
        [runRecordId]: explanationError instanceof Error
          ? explanationError.message
          : "Could not explain this failure.",
      }));
      return null;
    } finally {
      setExplainingRunId(null);
    }
  }

  async function explainAndDraftFollowup(runRecordId: string, suite: RegressionSuiteOption) {
    setFollowupLoadingRunId(runRecordId);
    setFollowupErrors((current) => {
      const next = { ...current };
      delete next[runRecordId];
      return next;
    });
    setFollowupDrafts((current) => {
      const next = { ...current };
      delete next[runRecordId];
      return next;
    });
    const explanation = await explainFailure(runRecordId);
    if (!explanation) {
      setFollowupLoadingRunId(null);
      return;
    }

    setGeneratingCases(true);
    try {
      const response = await fetch("/api/regression/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toolIds: suite.tool_ids,
          runRecordId,
          hint: `Create follow-up regression cases based on this evidence-linked failure explanation: ${explanation.summary}`.slice(0, 1000),
        }),
      });
      const body: unknown = await response.json();
      const record = isRecord(body) ? body : {};
      if (!response.ok) {
        throw new Error(typeof record.error === "string" ? record.error : "Could not draft follow-up cases.");
      }
      const drafts = parseRegressionTestCases(record.testCases);
      if (drafts.length === 0) throw new Error("Meta returned no valid follow-up cases.");
      setFollowupDrafts((current) => ({ ...current, [runRecordId]: drafts }));
    } catch (draftError) {
      setFollowupErrors((current) => ({
        ...current,
        [runRecordId]: draftError instanceof Error ? draftError.message : "Could not draft follow-up cases.",
      }));
    } finally {
      setGeneratingCases(false);
      setFollowupLoadingRunId(null);
    }
  }

  async function saveFollowupDraft(runRecordId: string, suite: RegressionSuiteOption) {
    const drafts = followupDrafts[runRecordId];
    if (!drafts?.length || savingFollowupRunId) return;
    setSavingFollowupRunId(runRecordId);
    setFollowupErrors((current) => {
      const next = { ...current };
      delete next[runRecordId];
      return next;
    });
    try {
      const result = await createRegressionSuite({
        name: `${suite.name} follow-up`.slice(0, 80),
        prompt: drafts[0].prompt,
        testCases: drafts,
        toolIds: suite.tool_ids,
        expectedToolIds: suite.expected_tool_ids,
        requiredAnswerText: suite.required_answer_text,
        responseAssertions: parseRegressionResponseAssertions(suite.response_assertions, suite.tool_ids),
        semanticCriteria: suite.semantic_criteria,
      });
      if (!result.success) throw new Error(result.error);
      setNotice(`Saved ${drafts.length} reviewed Meta follow-up case${drafts.length === 1 ? "" : "s"} as a new regression test.`);
      setFollowupDrafts((current) => {
        const next = { ...current };
        delete next[runRecordId];
        return next;
      });
      router.refresh();
    } catch (saveError) {
      setFollowupErrors((current) => ({
        ...current,
        [runRecordId]: saveError instanceof Error ? saveError.message : "Could not save the follow-up test.",
      }));
    } finally {
      setSavingFollowupRunId(null);
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
        <section className="space-y-4 rounded-md border border-violet-200 bg-violet-50/40 p-4" aria-labelledby="mockagent-demo-title">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 id="mockagent-demo-title" className="text-sm font-semibold text-violet-950">60-second Meta coverage demo</h3>
              <p className="mt-1 text-sm text-slate-600">
                Watch a scripted flawed agent hit the delayed-order edge case, ask Meta to explain and draft a regression case, then confirm it and rerun the corrected sample agent.
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={runDemo}
              disabled={demo?.status === "analyzing"}
            >
              <Play className="h-4 w-4" />
              {demo?.status === "analyzing" ? "Meta is reviewing…" : "Run demo"}
            </Button>
          </div>

          <p className="text-xs text-slate-600">
            Sandbox only: agent behavior, tools, and responses are deterministic local fixtures; no real refund, inventory, or workspace test is created. Only the explanation and draft use Meta, consuming one AI request from the current workspace quota.
          </p>

          <div className="grid gap-2 sm:grid-cols-3">
            {DEMO_TOOLS.map((tool) => (
              <div key={tool.id} className="rounded border border-violet-100 bg-white p-2 text-xs">
                <p className="font-medium text-slate-800">{tool.name}</p>
                <p className="mt-1 text-slate-500">{tool.description}</p>
                <p className="mt-1 text-[11px] text-violet-800">
                  {tool.scenarios.map((scenario) => scenario.name).join(" · ")}
                </p>
              </div>
            ))}
          </div>
          <p className="rounded bg-white/80 p-2 text-xs text-slate-600">
            <strong>Flawed sample prompt:</strong> {DEMO_FLAWED_AGENT_PROMPT}
            <span className="mt-1 block"><strong>Sequence edge case:</strong> <code>lookup_order(demo-42)</code> returns pending, then ready on the next call in the same simulated run.</span>
          </p>

          {demo && (
            <div className="space-y-3 rounded border border-violet-200 bg-white p-3">
              <ol className="grid gap-3 md:grid-cols-3">
                <li className="rounded bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-800">1 · Agent run</p>
                  <p className={`mt-1 text-xs font-medium ${demo.flawedRun.passed ? "text-emerald-700" : "text-red-700"}`}>
                    {demo.flawedRun.passed ? "Passed" : "Failed"}: {DEMO_FAILED_CHECK}
                  </p>
                  <div className="mt-2 space-y-2">
                    {demo.flawedRun.calls.map((call, index) => (
                      <div key={`${call.toolId}-${index}`} className="rounded bg-white p-2 text-[11px]">
                        <p className="font-medium text-slate-700">{call.toolName} · HTTP {call.status}</p>
                        <p className="mt-1 break-all text-slate-500">Args: {call.arguments}</p>
                        <p className="break-all text-slate-500">Response: {call.response}</p>
                      </div>
                    ))}
                  </div>
                </li>
                <li className="rounded bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-800">2 · Meta explanation</p>
                  {demo.status === "analyzing" ? (
                    <p className="mt-2 text-xs text-slate-500">Sending the fixed demo evidence to Meta…</p>
                  ) : demo.explanation ? (
                    <>
                      {demo.model && <p className="mt-1 text-[11px] text-violet-800">Model: {demo.model}</p>}
                      <p className="mt-2 text-xs text-slate-700">{demo.explanation.summary}</p>
                      {demo.aiUsage && <p className="mt-2 text-[11px] text-slate-500">AI usage: {demo.aiUsage.used}/{demo.aiUsage.limit}</p>}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">Run the demo to ask Meta for an evidence-linked explanation and case draft.</p>
                  )}
                </li>
                <li className="rounded bg-slate-50 p-3">
                  <p className="text-xs font-semibold text-slate-800">3 · Regression rerun</p>
                  {demo.status === "complete" && demo.correctedRun ? (
                    <>
                      <p className="mt-1 text-xs font-medium text-emerald-700">Passed with {demo.savedCases.length} reviewed regression case{demo.savedCases.length === 1 ? "" : "s"}.</p>
                      <p className="mt-1 text-xs text-emerald-700">Check passed: no refund was attempted while the order status was pending.</p>
                      <p className="mt-2 text-[11px] text-slate-600"><strong>Corrected sample prompt:</strong> {DEMO_CORRECTED_AGENT_PROMPT}</p>
                      <p className="mt-2 text-xs text-slate-700">{demo.correctedRun.actual}</p>
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">Review Meta&apos;s draft, then add it to the browser-only demo suite to rerun.</p>
                  )}
                </li>
              </ol>

              {demo.status === "review" && demo.draftCases.length > 0 && (
                <div className="space-y-3 rounded border border-violet-200 bg-violet-50/40 p-3">
                  <p className="text-xs text-violet-950">
                    <strong>Meta draft{demo.model ? ` · ${demo.model}` : ""}:</strong> Review and edit before adding it. The draft stays in this browser and is not written to your workspace.
                  </p>
                  {demo.explanation?.findings.map((finding, index) => (
                    <div key={`${finding.checkName}-${index}`} className="rounded bg-white p-2 text-xs">
                      <p className="font-medium text-slate-800">{finding.checkName}</p>
                      <p className="mt-1 text-slate-600">{finding.explanation}</p>
                      <p className="mt-1 text-slate-600"><strong>Suggested action:</strong> {finding.suggestedAction}</p>
                    </div>
                  ))}
                  {demo.draftCases.map((draftCase, index) => (
                    <div key={`${index}-${draftCase.name}`} className="space-y-1.5 rounded bg-white p-2">
                      <Label htmlFor={`demo-case-${index}-name`}>Regression case name</Label>
                      <Input
                        id={`demo-case-${index}-name`}
                        value={draftCase.name}
                        maxLength={80}
                        onChange={(event) => {
                          const caseName = event.currentTarget.value;
                          setDemo((current) => current
                            ? {
                                ...current,
                                draftCases: current.draftCases.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, name: caseName } : item
                                ),
                              }
                            : current);
                        }}
                      />
                      <Label htmlFor={`demo-case-${index}-prompt`}>Prompt</Label>
                      <Textarea
                        id={`demo-case-${index}-prompt`}
                        value={draftCase.prompt}
                        maxLength={5000}
                        rows={2}
                        onChange={(event) => {
                          const prompt = event.currentTarget.value;
                          setDemo((current) => current
                            ? {
                                ...current,
                                draftCases: current.draftCases.map((item, itemIndex) =>
                                  itemIndex === index ? { ...item, prompt } : item
                                ),
                              }
                            : current);
                        }}
                      />
                    </div>
                  ))}
                  <Button type="button" size="sm" onClick={addDemoRegressionAndRerun}>
                    Add reviewed regression test &amp; rerun
                  </Button>
                </div>
              )}

              {(demo.status === "error" || demo.error) && (
                <p role="alert" className="text-xs text-red-700">{demo.error ?? "The demo could not be completed."}</p>
              )}

              <div className="space-y-2 rounded border border-slate-200 p-3" aria-label="Demo coverage improvement">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-800">Coverage improvement</p>
                  <p className="text-xs text-slate-600">
                    {demo.coverageBefore}% before
                    {demo.coverageAfter === null ? " → — after" : ` → ${demo.coverageAfter}% after`}
                    {demo.coverageAfter !== null && ` · ${demo.coverageAfter - demo.coverageBefore >= 0 ? "+" : ""}${demo.coverageAfter - demo.coverageBefore}%`}
                  </p>
                </div>
                <div className="h-2 overflow-hidden rounded bg-slate-100" role="meter" aria-label="Demo tool coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={demo.coverageAfter ?? demo.coverageBefore}>
                  <div className="flex h-full">
                    <span className="bg-violet-300" style={{ width: `${demo.coverageBefore}%` }} />
                    {demo.coverageAfter !== null && (
                      <span className="bg-emerald-500" style={{ width: `${Math.max(0, demo.coverageAfter - demo.coverageBefore)}%` }} />
                    )}
                  </div>
                </div>
                {demo.status === "complete" && (
                  <p className="text-[11px] text-slate-500">
                    {measureDemoCoverage([demo.flawedRun, ...(demo.correctedRun ? [demo.correctedRun] : [])]).covered} coverage points reached after rerun.
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        <div className="space-y-3 rounded-md border border-slate-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Suite portability</h3>
              <p className="text-xs text-slate-500">
                Export versioned JSON or import suites with explicit mapping to active tools in this workspace.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                aria-label="Choose a regression suite export"
                onChange={(event) => {
                  const file = event.currentTarget.files?.[0];
                  void readSuiteImport(file);
                  event.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!schemaReady || selectableTools.length === 0 || importing}
                onClick={() => importInputRef.current?.click()}
              >
                Import JSON
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={suites.length === 0 || importing}
                onClick={exportSuites}
              >
                Export all
              </Button>
            </div>
          </div>
          {pendingImport && (
            <div className="space-y-3 rounded bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-800">
                Map tools for {pendingImport.length} imported suite{pendingImport.length === 1 ? "" : "s"}
              </p>
              {[...new Set(pendingImport.flatMap((item) => [
                ...item.toolNames,
                ...(item.expectedToolNames ?? []),
                ...item.suite.responseAssertions.map((assertion) => assertion.toolId),
              ]))].map((externalName) => (
                <label key={externalName} className="grid gap-1 text-xs text-slate-700 sm:grid-cols-[1fr_1fr] sm:items-center">
                  <span>Exported tool: <strong>{externalName}</strong></span>
                  <select
                    className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm"
                    value={importToolMappings[externalName] ?? ""}
                    onChange={(event) => setImportToolMappings((current) => ({
                      ...current,
                      [externalName]: event.currentTarget.value,
                    }))}
                  >
                    <option value="">Select an active tool</option>
                    {selectableTools.map((tool) => (
                      <option key={tool.id} value={tool.id}>{tool.name}</option>
                    ))}
                  </select>
                </label>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={importSuites} disabled={importing}>
                  {importing ? "Importing…" : "Import suites"}
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => setPendingImport(null)} disabled={importing}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          {suiteTransferError && <p role="alert" className="text-sm text-red-700">{suiteTransferError}</p>}
          {suiteTransferNotice && <p role="status" className="text-sm text-emerald-700">{suiteTransferNotice}</p>}
        </div>
        {!schemaReady ? (
          <p role="status" className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">
            Run the latest <code>schema.sql</code> in Supabase to enable saved regression tests and run history.
          </p>
        ) : selectableTools.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">
            Create an active mock tool before saving a regression test.
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
              <div className="space-y-2 rounded border border-violet-200 bg-violet-50/50 p-3">
                <Label htmlFor="regression-generation-hint">Optional focus for generated cases</Label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Input
                    id="regression-generation-hint"
                    value={generationHint}
                    onChange={(event) => setGenerationHint(event.currentTarget.value)}
                    maxLength={1000}
                    placeholder="For example: cover retries and stale order status"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => generateCases()}
                      disabled={generatingCases || selectedToolIds.length === 0 || testCases.length >= MAX_REGRESSION_TEST_CASES}
                    >
                      <Sparkles className="h-4 w-4" />
                      {generatingCases ? "Generating…" : "Generate with Meta AI"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => generateCases(undefined, selectedToolIds, undefined, true)}
                      disabled={generatingCases || selectedToolIds.length === 0 || testCases.length >= MAX_REGRESSION_TEST_CASES}
                    >
                      <Lightbulb className="h-4 w-4" />
                      {generatingCases ? "Generating…" : "Target coverage gaps"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={reviewSelectedContracts}
                      disabled={reviewingContracts || generatingCases || selectedToolIds.length === 0}
                    >
                      <Lightbulb className="h-4 w-4" />
                      {reviewingContracts ? "Reviewing…" : "Review contract risks"}
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-slate-500">
                  Selected tool definitions are sent to the configured AI provider. Coverage-guided generation prioritizes uncovered arguments, enum values, scenarios, and response steps from the latest 100 saved runs. Contract review returns advisory risks with evidence and test prompts. Follow-up generation also sends failed checks and a bounded trace. Generated prompts are drafts; review and edit before saving. Standalone generation and contract review each use one workspace AI request; Explain &amp; draft follow-up uses two.
                </p>
                {contractReviewError && <p role="alert" className="text-sm text-red-700">{contractReviewError}</p>}
                {contractReview && (
                  <section aria-label="Meta contract risk review" className="space-y-3 rounded border border-violet-200 bg-white p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-sm text-slate-700">{contractReview.summary}</p>
                      {contractReviewModel && <span className="text-xs text-slate-500">{contractReviewModel}</span>}
                    </div>
                    {contractReview.findings.length === 0 ? (
                      <p className="text-sm text-emerald-700">No material risks identified in the supplied contracts. This advisory review is not a guarantee of correctness.</p>
                    ) : (
                      <ul className="space-y-2">
                        {contractReview.findings.map((finding, index) => (
                          <li key={`${finding.toolName}-${index}`} className="rounded border border-slate-200 p-3">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className={`rounded px-2 py-0.5 font-semibold uppercase ${
                                finding.severity === "high" ? "bg-red-100 text-red-800" :
                                  finding.severity === "medium" ? "bg-amber-100 text-amber-800" :
                                    "bg-slate-100 text-slate-700"
                              }`}>{finding.severity}</span>
                              <span className="font-medium text-slate-800">{finding.toolName}</span>
                              <span className="text-slate-500">{finding.area}</span>
                            </div>
                            <p className="mt-2 break-all text-xs text-slate-600"><strong>Contract reference:</strong> <code>{finding.reference}</code></p>
                            <p className="mt-1 text-sm text-slate-700">{finding.risk}</p>
                            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                              <p className="min-w-[220px] flex-1 text-xs text-slate-500"><strong>Suggested test:</strong> {finding.testPrompt}</p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                disabled={testCases.length >= MAX_REGRESSION_TEST_CASES}
                                onClick={() => addContractFinding(finding, index)}
                              >
                                <Plus className="h-4 w-4" /> Add as draft
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}
              </div>
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
                  const unavailable = !tool.is_active;
                  return (
                    <label key={tool.id} className={`flex items-center gap-2 rounded border p-2 text-sm ${unavailable ? "text-slate-400" : "text-slate-700"}`}>
                      <input
                        type="checkbox"
                        checked={selectedToolIds.includes(tool.id)}
                        onChange={() => toggleTool(tool.id)}
                        disabled={unavailable || (!selectedToolIds.includes(tool.id) && selectedToolIds.length >= MAX_PLAYGROUND_TOOLS) || isPending}
                      />
                      {tool.name}{unavailable ? <span className="text-xs">(disabled)</span> : tool.require_api_key ? <span className="text-xs">(API key protected)</span> : null}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {credentialToolIds.some((id) => toolById.get(id)?.require_api_key) && (
              <fieldset className="space-y-3 rounded border border-amber-200 bg-amber-50/50 p-3">
                <legend className="px-1 text-sm font-medium text-slate-800">Temporary tool credentials</legend>
                <p className="text-xs text-slate-600">
                  Enter keys only for this browser session. They are sent to MockAgent&apos;s gateway for the matching tool and are never saved with the test or sent to the model.
                </p>
                {credentialToolIds
                  .map((id) => toolById.get(id))
                  .filter((tool): tool is RegressionToolOption => Boolean(tool?.require_api_key))
                  .map((tool) => (
                    <div key={tool.id} className="space-y-1">
                      <Label htmlFor={`regression-api-key-${tool.id}`}>{tool.name} API key</Label>
                      <Input
                        id={`regression-api-key-${tool.id}`}
                        type="password"
                        autoComplete="off"
                        value={toolApiKeys[tool.id] ?? ""}
                        onChange={(event) =>
                          setToolApiKeys((current) => ({ ...current, [tool.id]: event.currentTarget.value }))
                        }
                        maxLength={256}
                        placeholder="Required when running this test"
                      />
                    </div>
                  ))}
              </fieldset>
            )}

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
                      {selectedToolIds.map((id) => (
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
              <p className="text-xs text-slate-500">Checks are case-insensitive substring matches. For model-based support checking, configure Semantic QA criteria below.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="regression-semantic-criteria">Semantic answer QA criteria (optional)</Label>
              <Textarea
                id="regression-semantic-criteria"
                value={semanticCriteria}
                onChange={(event) => setSemanticCriteria(event.currentTarget.value)}
                maxLength={2000}
                rows={3}
                placeholder="The answer must use the newest successful timestamped order status and must not invent delivery details."
              />
              <p className="text-xs text-slate-500">
                Uses one additional model-judge request per case when evidence is available. The judge can make mistakes; review its rationale and evidence.
              </p>
            </div>

            <div className="space-y-3 rounded border border-slate-200 p-3">
              <div>
                <h4 className="text-sm font-medium text-slate-800">Tool-response assertions</h4>
                <p className="mt-1 text-xs text-slate-500">
                  Check a field from the first call to a selected tool. Use dot notation such as <code>data.status</code>. Choose “Matches JSON Schema” to validate an entire response object or nested response field.
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
                        {assertion.scope === "all" && <> <span>(all calls)</span></>}
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
                  <option value="matches_schema">Matches JSON Schema</option>
                </select>
                <select
                  aria-label="Response assertion call scope"
                  className="h-9 min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm"
                  value={assertionScope}
                  onChange={(event) => {
                    if (event.currentTarget.value === "first" || event.currentTarget.value === "all") {
                      setAssertionScope(event.currentTarget.value);
                    }
                  }}
                >
                  <option value="first">First call</option>
                  <option value="all">Every call</option>
                </select>
                {assertionOperator !== "exists" && (
                  <Textarea
                    aria-label={assertionOperator === "matches_schema" ? "Expected JSON Schema" : "Expected JSON value"}
                    value={assertionExpected}
                    onChange={(event) => setAssertionExpected(event.currentTarget.value)}
                    rows={assertionOperator === "matches_schema" ? 4 : 2}
                    placeholder={assertionOperator === "matches_schema"
                      ? '{"type":"object","properties":{"status":{"type":"string"}},"required":["status"],"additionalProperties":false}'
                      : '"shipped", 100, or true'}
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

        <section aria-labelledby="regression-coverage-title" className="space-y-3 rounded-md border border-slate-200 p-4">
          <div>
            <h3 id="regression-coverage-title" className="text-sm font-semibold text-slate-800">Regression coverage</h3>
            <p className="text-xs text-slate-500">
              {coverage.percentage}% of configured argument fields, enum values, scenarios, and response steps were observed in successful saved-test traces.
              This reflects {loadedRuns.length} loaded run records, not the entire workspace history.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-600">
            <span className="font-medium text-slate-900">{coverage.covered}/{coverage.total} coverage points</span>
            <span>{coverage.observedCalls} successful tool calls</span>
            {coverage.invalidTraces > 0 && <span>{coverage.invalidTraces} malformed trace{coverage.invalidTraces === 1 ? "" : "s"} excluded</span>}
            {coverage.invalidToolConfigurations > 0 && <span>{coverage.invalidToolConfigurations} invalid scenario configuration{coverage.invalidToolConfigurations === 1 ? "" : "s"} excluded</span>}
          </div>
          <div className="h-2 overflow-hidden rounded bg-slate-100" role="meter" aria-label="Regression coverage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={coverage.percentage}>
            <div className="h-full bg-violet-500" style={{ width: `${coverage.percentage}%` }} />
          </div>
          {coverage.tools.length > 0 && (
            <ul className="grid gap-2 sm:grid-cols-2">
              {coverage.tools.map((tool) => (
                <li key={tool.id} className="rounded border border-slate-100 p-2 text-xs">
                  <p className="truncate font-medium text-slate-800" title={tool.name}>{tool.name}</p>
                  <p className="mt-1 text-slate-500">
                    Fields {tool.fields.covered}/{tool.fields.total} · enum values {tool.enumValues.covered}/{tool.enumValues.total} · scenarios/steps {tool.scenarios.covered}/{tool.scenarios.total}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>

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
              <div className="flex flex-wrap items-center gap-2">
                <label className="flex items-center gap-2 text-xs text-slate-600">
                  Auto-improve rounds
                  <select
                    aria-label="Maximum auto-improve rounds"
                    className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
                    value={autoImproveRoundLimit}
                    onChange={(event) => {
                      try {
                        setAutoImproveRoundLimit(parseAutoImproveRoundLimit(Number(event.currentTarget.value)));
                      } catch (roundError) {
                        setError(roundError instanceof Error ? roundError.message : "Auto-improve round limit is invalid.");
                      }
                    }}
                    disabled={runningSuiteId !== null || isPending || autoImprove?.status === "running" || autoImprove?.status === "review"}
                  >
                    <option value={2}>2 rounds</option>
                    <option value={3}>3 rounds</option>
                  </select>
                </label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={runAllSuites}
                  disabled={runningSuiteId !== null || isPending || autoImprove?.status === "review" || autoImprove?.status === "running"}
                >
                  <Play className="h-4 w-4" />
                  Run all ({suites.reduce((total, suite) => total + suite.test_cases.length, 0)} cases)
                </Button>
              </div>
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
              const branchSource = latestRun?.branch_from_run_id
                ? loadedRuns.find((run) => run.id === latestRun.branch_from_run_id)
                : undefined;
              const previousTrace = previousRun ? readRunTrace(previousRun.trace) : null;
              const traceDifferences =
                latestTrace && previousTrace ? compareRunTraces(previousTrace, latestTrace) : null;
              const suiteAutoImprove = autoImprove?.sourceSuiteId === suite.id ? autoImprove : null;
              const suiteAutoCoverage = suiteAutoImprove
                ? getCoverageForSuite(suite, suiteAutoImprove.runs)
                : null;
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
                      {suite.semantic_criteria && (
                        <p className="text-xs text-slate-500">Semantic QA: {suite.semantic_criteria}</p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" size="sm" onClick={() => runSuite(suite.id)} disabled={runningSuiteId !== null || isPending || autoImprove?.status === "review" || autoImprove?.status === "running"}>
                        <Play className="h-4 w-4" />
                        {runningSuiteId === suite.id ? "Running…" : "Run"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => startAutoImprove(suite)}
                        disabled={runningSuiteId !== null || isPending || autoImprove?.status === "review" || autoImprove?.status === "running"}
                        title="Run baseline cases, then ask Meta to draft tests for uncovered behavior"
                      >
                        <Sparkles className="h-4 w-4" />
                        Auto-improve
                      </Button>
                      <Button type="button" variant="destructive" size="icon" aria-label={`Delete ${suite.name}`} disabled={runningSuiteId !== null || isPending || autoImprove?.status === "review" || autoImprove?.status === "running"} onClick={() => removeSuite(suite.id, suite.name)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {runResults[suite.id] && renderResult(runResults[suite.id])}
                  {runErrors[suite.id] && <p role="alert" className="mt-3 text-sm text-red-700">{runErrors[suite.id]}</p>}
                  {suiteAutoImprove && suiteAutoCoverage && (
                    <section
                      className="mt-3 space-y-3 rounded-md border border-violet-200 bg-violet-50/50 p-3"
                      aria-label="Coverage improvement"
                      aria-live="polite"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <h5 className="text-sm font-semibold text-violet-950">Meta coverage improvement</h5>
                          <p className="mt-1 text-xs text-slate-600">
                            Baseline: {suiteAutoImprove.baselineBefore}% before rerun → {suiteAutoImprove.baselineAfter}% after saved cases.
                            {" "}Current: <strong>{suiteAutoImprove.currentCoverage}%</strong> · {suiteAutoCoverage.gaps.length} uncovered point{suiteAutoCoverage.gaps.length === 1 ? "" : "s"} · max {suiteAutoImprove.maxRounds} rounds
                          </p>
                          <p className="mt-1 text-[11px] text-slate-500">Coverage uses the latest 100 available saved traces for the selected tools, including this loop&apos;s confirmed runs.</p>
                        </div>
                        <span className="text-xs font-medium text-violet-800">
                          {suiteAutoImprove.status === "running" ? "In progress" :
                            suiteAutoImprove.status === "review" ? `Round ${suiteAutoImprove.draftRound} ready for review` :
                              suiteAutoImprove.status === "error" ? "Stopped with an error" : "Complete"}
                        </span>
                      </div>
                      <p className={`text-xs ${suiteAutoImprove.status === "error" ? "text-red-700" : "text-slate-600"}`}>
                        {suiteAutoImprove.message}
                      </p>
                      <ol className="space-y-1">
                        <li className="flex flex-wrap justify-between gap-2 text-xs text-slate-700">
                          <span>Baseline rerun</span>
                          <span>{suiteAutoImprove.baselineBefore}% → {suiteAutoImprove.baselineAfter}% · {suiteAutoImprove.baselinePassed} passed{suiteAutoImprove.baselineFailed ? ` · ${suiteAutoImprove.baselineFailed} failed` : ""}</span>
                        </li>
                        {suiteAutoImprove.rounds.map((step) => (
                          <li key={step.round} className="flex flex-wrap justify-between gap-2 text-xs text-slate-700">
                            <span>Round {step.round}: {step.caseCount} case{step.caseCount === 1 ? "" : "s"} · {step.passedCount} passed{step.failedCount ? ` · ${step.failedCount} failed` : ""}</span>
                            <span>
                              {step.before}% → {step.after}% ({step.delta > 0 ? "+" : ""}{step.delta}%)
                            </span>
                          </li>
                        ))}
                      </ol>
                      {suiteAutoImprove.status === "review" && suiteAutoImprove.draftRound !== null && (
                        <div className="space-y-3 rounded border border-violet-200 bg-white p-3">
                          <p className="text-xs text-slate-600">
                            Meta draft{suiteAutoImprove.draftModel ? ` · ${suiteAutoImprove.draftModel}` : ""}. Edit before confirming. Drafts are not stored yet; generated round tests do not inherit sequence, response, or answer assertions from the baseline.
                          </p>
                          {suiteAutoImprove.draftCases.map((draftCase, index) => (
                            <div key={`${index}-${draftCase.name}`} className="space-y-1.5">
                              <Label htmlFor={`auto-improve-case-${index}-name`}>Case name</Label>
                              <Input
                                id={`auto-improve-case-${index}-name`}
                                value={draftCase.name}
                                maxLength={80}
                                onChange={(event) => {
                                  const caseName = event.currentTarget.value;
                                  setAutoImprove((current) => current
                                    ? {
                                        ...current,
                                        draftCases: current.draftCases.map((item, itemIndex) =>
                                          itemIndex === index ? { ...item, name: caseName } : item
                                        ),
                                      }
                                    : current);
                                }}
                              />
                              <Label htmlFor={`auto-improve-case-${index}-prompt`}>Prompt</Label>
                              <Textarea
                                id={`auto-improve-case-${index}-prompt`}
                                value={draftCase.prompt}
                                maxLength={5000}
                                rows={2}
                                onChange={(event) => {
                                  const prompt = event.currentTarget.value;
                                  setAutoImprove((current) => current
                                    ? {
                                        ...current,
                                        draftCases: current.draftCases.map((item, itemIndex) =>
                                          itemIndex === index ? { ...item, prompt } : item
                                        ),
                                      }
                                    : current);
                                }}
                              />
                            </div>
                          ))}
                          <Button
                            type="button"
                            size="sm"
                            onClick={saveAndRunAutoImproveRound}
                            disabled={runningSuiteId !== null || isPending || suiteAutoImprove.draftCases.length === 0}
                          >
                            <Play className="h-4 w-4" /> Save &amp; run round {suiteAutoImprove.draftRound}
                          </Button>
                        </div>
                      )}
                    </section>
                  )}
                  {!runResults[suite.id] && latestRun && (
                    <div className="mt-3 border-t border-slate-100 pt-2">
                      <p className={`text-sm font-medium ${latestRun.status === "passed" ? "text-emerald-700" : "text-red-700"}`}>
                        Latest run ({latestRun.test_case_name}): {latestRun.status} · {new Date(latestRun.created_at).toLocaleString()}
                      </p>
                      <p className="truncate text-xs text-slate-500">Run ID: {latestRun.run_id}</p>
                      {latestRun.branch_from_run_id && (
                        <p className="truncate text-xs text-indigo-700">
                          Branch of {branchSource ? branchSource.run_id : latestRun.branch_from_run_id}
                        </p>
                      )}
                    </div>
                  )}
                  {latestRun && (
                    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
                      {latestRun.status === "failed" && (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={followupLoadingRunId !== null || generatingCases || savingFollowupRunId !== null}
                              onClick={() => explainAndDraftFollowup(latestRun.id, suite)}
                            >
                              {followupLoadingRunId === latestRun.id && explainingRunId === latestRun.id
                                ? <Lightbulb className="h-4 w-4" />
                                : <Sparkles className="h-4 w-4" />}
                              {followupLoadingRunId === latestRun.id
                                ? explainingRunId === latestRun.id ? "Explaining failure…" : "Drafting follow-up…"
                                : "Explain & draft follow-up"}
                            </Button>
                          </div>
                          {explanationErrors[latestRun.id] && (
                            <p role="alert" className="text-xs text-red-700">{explanationErrors[latestRun.id]}</p>
                          )}
                          {followupErrors[latestRun.id] && (
                            <p role="alert" className="text-xs text-red-700">{followupErrors[latestRun.id]}</p>
                          )}
                          {failureExplanations[latestRun.id] && (
                            <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
                              <p className="font-medium text-slate-900">{failureExplanations[latestRun.id].summary}</p>
                              <ul className="space-y-2">
                                {failureExplanations[latestRun.id].findings.map((finding, index) => (
                                  <li key={`${finding.checkName}-${index}`} className="text-slate-700">
                                    <p className="font-medium">{finding.checkName}</p>
                                    <p className="text-xs">{finding.explanation}</p>
                                    <p className="mt-1 text-xs"><strong>Suggested next step:</strong> {finding.suggestedAction}</p>
                                  </li>
                                ))}
                              </ul>
                              <p className="text-[11px] text-slate-500">AI suggestions can be wrong. Check the original trace and failed assertion before changing your test or tool.</p>
                              <p className="text-[11px] text-slate-500">Failed checks and a bounded run trace were sent to the configured AI provider for this explanation.</p>
                            </div>
                          )}
                          {followupDrafts[latestRun.id] && (
                            <div className="space-y-3 rounded border border-violet-200 bg-violet-50/50 p-3">
                              <p className="text-xs font-medium text-violet-950">Review and edit Meta&apos;s follow-up draft. Saving creates a new regression test; nothing is persisted before you confirm.</p>
                              {followupDrafts[latestRun.id].map((draftCase, index) => (
                                <div key={`${index}-${draftCase.name}`} className="space-y-1.5 rounded bg-white p-2">
                                  <Label htmlFor={`followup-${latestRun.id}-${index}-name`}>Case name</Label>
                                  <Input
                                    id={`followup-${latestRun.id}-${index}-name`}
                                    value={draftCase.name}
                                    maxLength={80}
                                    onChange={(event) => {
                                      const caseName = event.currentTarget.value;
                                      setFollowupDrafts((current) => ({
                                        ...current,
                                        [latestRun.id]: (current[latestRun.id] ?? []).map((item, itemIndex) =>
                                          itemIndex === index ? { ...item, name: caseName } : item
                                        ),
                                      }));
                                    }}
                                  />
                                  <Label htmlFor={`followup-${latestRun.id}-${index}-prompt`}>Prompt</Label>
                                  <Textarea
                                    id={`followup-${latestRun.id}-${index}-prompt`}
                                    value={draftCase.prompt}
                                    maxLength={5000}
                                    rows={2}
                                    onChange={(event) => {
                                      const prompt = event.currentTarget.value;
                                      setFollowupDrafts((current) => ({
                                        ...current,
                                        [latestRun.id]: (current[latestRun.id] ?? []).map((item, itemIndex) =>
                                          itemIndex === index ? { ...item, prompt } : item
                                        ),
                                      }));
                                    }}
                                  />
                                </div>
                              ))}
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => saveFollowupDraft(latestRun.id, suite)}
                                disabled={savingFollowupRunId !== null || isPending}
                              >
                                {savingFollowupRunId === latestRun.id ? "Saving…" : "Save reviewed follow-up test"}
                              </Button>
                            </div>
                          )}
                        </div>
                      )}
                      <h5 className="text-sm font-medium text-slate-800">Run trace</h5>
                      {latestTrace ? (
                        <details className="rounded border border-slate-200 p-3">
                          <summary className="cursor-pointer text-sm text-slate-700">
                            {latestTrace.calls.length} tool call{latestTrace.calls.length === 1 ? "" : "s"} · {latestTrace.metadata?.model ?? latestRun.model}
                          </summary>
                          <div className="mt-3 space-y-3">
                            <div className="rounded bg-violet-50 p-3 text-xs text-violet-950">
                              <p><strong>Model:</strong> {latestTrace.metadata?.model ?? latestRun.model}</p>
                              {latestTrace.metadata && <p><strong>Provider:</strong> {latestTrace.metadata.provider}</p>}
                              <p>
                                <strong>Responses API reasoning replay:</strong>{" "}
                                {latestTrace.metadata
                                  ? latestTrace.metadata.reasoningReplay ? "used (encrypted replay item carried between turns)" : "not used"
                                  : "metadata unavailable for this older run"}
                              </p>
                              <p className="mt-1 text-[11px] text-slate-600">Only replay status is recorded here; reasoning content is never displayed.</p>
                            </div>
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
                      {latestTrace && (
                        <div className="space-y-3 rounded border border-indigo-200 bg-indigo-50/50 p-3">
                          <div>
                            <h5 className="text-sm font-semibold text-indigo-950">Replay or branch this run</h5>
                            <p className="mt-1 text-xs leading-5 text-slate-600">
                              Re-run the saved prompt and checks with a fresh run ID. Replay uses the current tool definitions and scenarios; model output may vary. Branch to edit the prompt or choose another model. The original run is preserved for comparison.
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={replayRunId !== null || runningSuiteId !== null || isPending || !getPromptForRun(latestRun, suite).trim()}
                              onClick={() => replaySavedRun(latestRun, suite, false)}
                            >
                              <RotateCcw className="h-4 w-4" />
                              {replayRunId === latestRun.id ? "Replaying…" : "Replay run"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={replayRunId !== null || runningSuiteId !== null || isPending || !latestTrace}
                              onClick={() => {
                                setBranchPrompts((current) => ({
                                  ...current,
                                  [latestRun.id]: current[latestRun.id] ?? getPromptForRun(latestRun, suite),
                                }));
                                setBranchModels((current) => ({
                                  ...current,
                                  [latestRun.id]: current[latestRun.id] ?? latestRun.model,
                                }));
                                setBranchDraftRunId((current) => current === latestRun.id ? null : latestRun.id);
                                clearReplayError(latestRun.id);
                              }}
                            >
                              <GitBranch className="h-4 w-4" />
                              {branchDraftRunId === latestRun.id ? "Close branch editor" : "Branch from run"}
                            </Button>
                          </div>
                          {branchDraftRunId === latestRun.id && (
                            <div className="space-y-2 rounded border border-indigo-100 bg-white p-3">
                              <Label htmlFor={`branch-prompt-${latestRun.id}`}>Branch prompt</Label>
                              <Textarea
                                id={`branch-prompt-${latestRun.id}`}
                                value={branchPrompts[latestRun.id] ?? getPromptForRun(latestRun, suite)}
                                maxLength={5000}
                                rows={4}
                                onChange={(event) => setBranchPrompts((current) => ({
                                  ...current,
                                  [latestRun.id]: event.currentTarget.value,
                                }))}
                              />
                              <Label htmlFor={`branch-model-${latestRun.id}`}>Model</Label>
                              <Input
                                id={`branch-model-${latestRun.id}`}
                                value={branchModels[latestRun.id] ?? latestRun.model}
                                maxLength={100}
                                onChange={(event) => setBranchModels((current) => ({
                                  ...current,
                                  [latestRun.id]: event.currentTarget.value,
                                }))}
                              />
                              <p className="text-[11px] leading-5 text-slate-500">
                                The model must be available from the configured provider. Tool schemas, mock responses, and scenario settings use their current workspace versions.
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                disabled={replayRunId !== null || runningSuiteId !== null || isPending}
                                onClick={() => replaySavedRun(latestRun, suite, true)}
                              >
                                <GitBranch className="h-4 w-4" />
                                {replayRunId === latestRun.id ? "Running branch…" : "Run branch"}
                              </Button>
                            </div>
                          )}
                          {replayErrors[latestRun.id] && (
                            <p role="alert" className="text-xs text-red-700">{replayErrors[latestRun.id]}</p>
                          )}
                          {replayOutcomes[latestRun.id] && (
                            <div className="rounded border border-indigo-100 bg-white p-3">
                              <p className={`text-xs font-semibold ${replayOutcomes[latestRun.id].passed ? "text-emerald-700" : "text-red-700"}`}>
                                Replay {replayOutcomes[latestRun.id].passed ? "passed" : "failed"} · {replayOutcomes[latestRun.id].model} · run {replayOutcomes[latestRun.id].runId}
                              </p>
                              {replayOutcomes[latestRun.id].differences.length === 0 ? (
                                <p className="mt-2 text-xs text-emerald-700">No trace differences detected from the source run.</p>
                              ) : (
                                <ul className="mt-2 space-y-2">
                                  {replayOutcomes[latestRun.id].differences.map((difference, index) => (
                                    <li key={`${difference.label}-${index}`} className="grid gap-1 text-xs sm:grid-cols-[9rem_1fr_1fr]">
                                      <span className="font-medium text-slate-700">{difference.label}</span>
                                      <span className="line-clamp-4 break-all text-slate-500"><strong>Source:</strong> {difference.before}</span>
                                      <span className="line-clamp-4 break-all text-slate-700"><strong>Replay:</strong> {difference.after}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </div>
                          )}
                        </div>
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
        {suites.length === 0 && (
          <section className="rounded-md border border-dashed border-slate-300 bg-slate-50 p-4" aria-label="Saved regression tests">
            <h3 className="text-sm font-semibold text-slate-800">No saved regression tests yet</h3>
            <p className="mt-1 text-sm text-slate-600">
              Create a test above to save agent prompts and checks, or run the sandbox demo to see a Meta-assisted failure-to-regression workflow without creating workspace records.
            </p>
            {selectableTools.length === 0 && (
              <p className="mt-2 text-xs text-slate-500">Create an active mock tool before you can save a workspace regression test.</p>
            )}
          </section>
        )}
        {error && selectableTools.length === 0 && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {notice && selectableTools.length === 0 && <p role="status" className="text-sm text-emerald-700">{notice}</p>}
      </CardContent>
    </Card>
  );
}
