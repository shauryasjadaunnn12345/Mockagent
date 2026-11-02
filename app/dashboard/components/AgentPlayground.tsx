"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Bot, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MAX_PLAYGROUND_TOOLS } from "@/lib/agent-playground";

export interface PlaygroundToolOption {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  require_api_key: boolean;
}

interface PlaygroundCall {
  toolId: string;
  toolName: string;
  arguments: Record<string, unknown> | null;
  rawArguments?: string;
  response: unknown;
  status: number;
}

interface PlaygroundResult {
  runId: string;
  answer?: string;
  calls: PlaygroundCall[];
  model?: string;
  traceMetadata?: { model: string; provider: string; reasoningReplay: boolean };
  aiUsage?: { used: number; limit: number } | null;
}

interface AgentPlaygroundProps {
  tools: PlaygroundToolOption[];
  monthlyAIRequestsUsed: number | null;
  aiMonthlyRequestLimit: number;
  metaConfigured: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseCalls(value: unknown): PlaygroundCall[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (call): call is PlaygroundCall =>
      isRecord(call) &&
      typeof call.toolId === "string" &&
      typeof call.toolName === "string" &&
      (call.arguments === null || isRecord(call.arguments)) &&
      typeof call.status === "number" &&
      "response" in call,
  );
}

export function AgentPlayground({
  tools,
  monthlyAIRequestsUsed,
  aiMonthlyRequestLimit,
  metaConfigured,
}: AgentPlaygroundProps) {
  const selectableTools = tools.filter((tool) => tool.is_active);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    selectableTools.slice(0, 1).map((tool) => tool.id),
  );
  const [toolApiKeys, setToolApiKeys] = useState<Record<string, string>>({});
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [aiUsage, setAiUsage] = useState(monthlyAIRequestsUsed);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
  const [modelCatalogLoading, setModelCatalogLoading] = useState(metaConfigured);

  useEffect(() => {
    if (!metaConfigured) return;
    let active = true;
    fetch("/api/meta/models")
      .then(async (response) => {
        const body: unknown = await response.json();
        if (!response.ok) {
          const error = body && typeof body === "object" && typeof (body as Record<string, unknown>).error === "string"
            ? (body as { error: string }).error
            : "Could not load available Meta models.";
          throw new Error(error);
        }
        return body;
      })
      .then((body: unknown) => {
        if (!active || !body || typeof body !== "object") return;
        const record = body as Record<string, unknown>;
        if (!Array.isArray(record.models) || !record.models.every((model) => typeof model === "string")) {
          throw new Error("Meta model catalog returned an invalid response.");
        }
        const models = record.models as string[];
        setAvailableModels(models);
        const preferred = typeof record.defaultModel === "string" && models.includes(record.defaultModel)
          ? record.defaultModel
          : models[0] ?? "";
        setSelectedModel(preferred);
      })
      .catch((error: unknown) => {
        if (active) setModelCatalogError(error instanceof Error ? error.message : "Could not load Meta models.");
      })
      .finally(() => {
        if (active) setModelCatalogLoading(false);
      });
    return () => { active = false; };
  }, [metaConfigured]);

  function toggleTool(toolId: string) {
    if (selectedIds.includes(toolId)) {
      setSelectedIds((current) => current.filter((id) => id !== toolId));
      setToolApiKeys((keys) => {
        const next = { ...keys };
        delete next[toolId];
        return next;
      });
      return;
    }
    setSelectedIds((current) => {
      if (current.length >= MAX_PLAYGROUND_TOOLS) return current;
      return [...current, toolId];
    });
  }

  async function runAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRunning || !prompt.trim() || selectedIds.length === 0) return;
    const requiredTool = tools.find(
      (tool) => selectedIds.includes(tool.id) && tool.require_api_key && !toolApiKeys[tool.id]?.trim()
    );
    if (requiredTool) {
      setError(`Enter the API key for "${requiredTool.name}" to use it in this run.`);
      return;
    }

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          toolIds: selectedIds,
          ...(selectedModel ? { model: selectedModel } : {}),
          apiKeys: Object.fromEntries(
            selectedIds
              .filter((toolId) => toolApiKeys[toolId])
              .map((toolId) => [toolId, toolApiKeys[toolId]])
          ),
        }),
      });
      const body: unknown = await response.json();
      const responseBody = isRecord(body) ? body : {};
      const runId = typeof responseBody.runId === "string" ? responseBody.runId : "";
      const calls = parseCalls(responseBody.calls);
      const answer = typeof responseBody.answer === "string" ? responseBody.answer : undefined;
      const model = typeof responseBody.model === "string" ? responseBody.model : undefined;
      const traceMetadataValue = responseBody.traceMetadata;
      const traceMetadata = isRecord(traceMetadataValue) &&
        typeof traceMetadataValue.model === "string" &&
        typeof traceMetadataValue.provider === "string" &&
        typeof traceMetadataValue.reasoningReplay === "boolean"
        ? {
            model: traceMetadataValue.model,
            provider: traceMetadataValue.provider,
            reasoningReplay: traceMetadataValue.reasoningReplay,
          }
        : undefined;
      const usageValue = responseBody.aiUsage;
      const usage = isRecord(usageValue) && typeof usageValue.used === "number"
        ? usageValue.used
        : null;
      if (usage !== null) setAiUsage(usage);

      if (!response.ok) {
        setResult(runId ? {
          runId,
          calls,
          ...(traceMetadata ? { traceMetadata } : {}),
          aiUsage: isRecord(usageValue) && typeof usageValue.used === "number" && typeof usageValue.limit === "number"
            ? { used: usageValue.used, limit: usageValue.limit }
            : null,
        } : null);
        setError(
          typeof responseBody.error === "string"
            ? responseBody.error
            : "The agent run failed.",
        );
        return;
      }

      if (!runId || !answer) {
        setError("The Playground returned an incomplete run.");
        return;
      }
      setResult({
        runId,
        answer,
        calls,
        model,
        ...(traceMetadata ? { traceMetadata } : {}),
        aiUsage: isRecord(usageValue) && typeof usageValue.used === "number" && typeof usageValue.limit === "number"
          ? { used: usageValue.used, limit: usageValue.limit }
          : null,
      });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The agent run failed.");
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Bot className="h-4 w-4" />
          Agent Playground
        </CardTitle>
        <p className="text-sm text-slate-500">
          Run a Meta-powered agent against your active mock tools. Each call goes through the normal MockAgent gateway and appears in Execution Logs. API keys are entered for this run only and are never sent to the model.
        </p>
      </CardHeader>
      <CardContent>
        {!metaConfigured ? (
          <p role="alert" className="rounded-md bg-amber-50 p-4 text-sm text-amber-800">
            Meta AI is not configured for this deployment. Configure the server-side model provider to run the Playground.
          </p>
        ) : selectableTools.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">
            Create an active mock tool to run your first agent test.
          </p>
        ) : (
          <form onSubmit={runAgent} className="space-y-4">
            {modelCatalogLoading && (
              <p role="status" aria-live="polite" className="text-xs text-slate-500">Loading available Meta models…</p>
            )}
            {availableModels.length > 1 && (
              <div className="space-y-1.5">
                <label htmlFor="agent-playground-model" className="text-sm font-medium text-slate-800">
                  Meta model
                </label>
                <select
                  id="agent-playground-model"
                  value={selectedModel}
                  onChange={(event) => setSelectedModel(event.currentTarget.value)}
                  disabled={isRunning}
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800"
                >
                  {availableModels.map((model) => <option key={model} value={model}>{model}</option>)}
                </select>
                <p className="text-xs text-slate-500">
                  Muse Spark is the balanced default; Muse Wonder models may provide deeper reasoning and may have different access or cost.
                </p>
              </div>
            )}
            {modelCatalogError && (
              <p role="status" className="text-xs text-amber-700">
                Could not load the Meta model catalog; the server-configured default will be used. {modelCatalogError}
              </p>
            )}
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-slate-800">
                Tools available to the agent ({selectedIds.length}; up to {MAX_PLAYGROUND_TOOLS} tools)
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {tools.map((tool) => {
                  const unavailable = !tool.is_active;
                  const checked = selectedIds.includes(tool.id);
                  return (
                    <div
                      key={tool.id}
                      className={`space-y-2 rounded-md border p-3 text-sm ${
                        unavailable ? "border-slate-100 bg-slate-50 text-slate-400" : "border-slate-200"
                      }`}
                      title={
                        !tool.is_active
                          ? "Enable this tool before using it in a run."
                          : undefined
                      }
                    >
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={unavailable || (!checked && selectedIds.length >= MAX_PLAYGROUND_TOOLS) || isRunning}
                          onChange={() => toggleTool(tool.id)}
                          className="mt-0.5 h-4 w-4"
                        />
                        <span>
                          <span className="block font-medium text-slate-800">{tool.name}</span>
                          <span className="block text-xs text-slate-500">
                            {unavailable
                              ? "Disabled"
                              : `${tool.require_api_key ? "API key protected · " : ""}${tool.description || "No description"}`}
                          </span>
                        </span>
                      </label>
                      {checked && tool.require_api_key && (
                        <input
                          type="password"
                          autoComplete="off"
                          aria-label={`Temporary API key for ${tool.name}`}
                          value={toolApiKeys[tool.id] ?? ""}
                          onChange={(event) =>
                            setToolApiKeys((current) => ({ ...current, [tool.id]: event.currentTarget.value }))
                          }
                          placeholder="Paste API key for this run"
                          maxLength={256}
                          disabled={isRunning}
                          className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-800"
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </fieldset>

            <div className="space-y-2">
              <label htmlFor="agent-playground-prompt" className="text-sm font-medium text-slate-800">
                Agent task
              </label>
              <Textarea
                id="agent-playground-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                placeholder="Example: Check order 123 and tell me whether it is eligible for a refund."
                rows={4}
                maxLength={5000}
                disabled={isRunning}
                required
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-slate-500">
                Runs stop at the request deadline and are bounded by workspace AI quotas and rate limits. Each model completion uses one monthly AI request. Native Meta Model API runs use Responses API reasoning replay. Prompts and tool results are sent to the configured provider.
                {` Usage: ${aiUsage === null ? "unavailable" : `${aiUsage.toLocaleString()} / ${aiMonthlyRequestLimit.toLocaleString()}`}.`}
              </p>
              <Button type="submit" disabled={isRunning || modelCatalogLoading || !prompt.trim() || selectedIds.length === 0}>
                <Play className="h-4 w-4" />
                {isRunning ? "Running agent…" : "Run agent"}
              </Button>
            </div>
          </form>
        )}

        {error && <p role="alert" className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}

        {result && (
          <section aria-live="polite" className="mt-5 space-y-3 border-t border-slate-200 pt-4">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500">
              <span>Run ID: <code className="font-mono">{result.runId}</code></span>
              <span>
                Model: {result.traceMetadata?.model ?? result.model ?? "unknown"}
                {result.traceMetadata && ` · ${result.traceMetadata.provider}`}
              </span>
              {result.traceMetadata && (
                <span>
                  Responses API reasoning replay: {result.traceMetadata.reasoningReplay ? "used" : "not used"}
                </span>
              )}
            </div>
            {result.answer && (
              <div>
                <h3 className="mb-1 text-sm font-medium text-slate-800">Final answer</h3>
                <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-3 text-sm text-slate-700">
                  {result.answer}
                </p>
              </div>
            )}
            {result.calls.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-slate-800">Tool calls ({result.calls.length})</h3>
                {result.calls.map((call, index) => (
                  <details key={`${call.toolId}-${index}`} className="rounded-md border border-slate-200 p-3">
                    <summary className="cursor-pointer text-sm">
                      <span className="font-medium">{call.toolName}</span>
                      <span className={`ml-2 text-xs ${call.status >= 200 && call.status < 300 ? "text-emerald-700" : "text-red-700"}`}>
                        HTTP {call.status}
                      </span>
                    </summary>
                    <div className="mt-3 space-y-2">
                      <pre className="overflow-x-auto rounded bg-slate-50 p-2 text-xs">
                        {JSON.stringify(call.arguments ?? call.rawArguments, null, 2)}
                      </pre>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-slate-50 p-2 text-xs">
                        {JSON.stringify(call.response, null, 2)}
                      </pre>
                    </div>
                  </details>
                ))}
              </div>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
