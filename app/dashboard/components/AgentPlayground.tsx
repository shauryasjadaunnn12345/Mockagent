"use client";

import { useState, type FormEvent } from "react";
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
  aiUsage?: { used: number; limit: number } | null;
}

interface AgentPlaygroundProps {
  tools: PlaygroundToolOption[];
  monthlyAIRequestsUsed: number | null;
  aiMonthlyRequestLimit: number;
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
}: AgentPlaygroundProps) {
  const selectableTools = tools.filter((tool) => tool.is_active && !tool.require_api_key);
  const [selectedIds, setSelectedIds] = useState<string[]>(
    selectableTools.slice(0, MAX_PLAYGROUND_TOOLS).map((tool) => tool.id),
  );
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<PlaygroundResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [aiUsage, setAiUsage] = useState(monthlyAIRequestsUsed);

  function toggleTool(toolId: string) {
    setSelectedIds((current) => {
      if (current.includes(toolId)) return current.filter((id) => id !== toolId);
      if (current.length >= MAX_PLAYGROUND_TOOLS) return current;
      return [...current, toolId];
    });
  }

  async function runAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRunning || !prompt.trim() || selectedIds.length === 0) return;

    setIsRunning(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, toolIds: selectedIds }),
      });
      const body: unknown = await response.json();
      const responseBody = isRecord(body) ? body : {};
      const runId = typeof responseBody.runId === "string" ? responseBody.runId : "";
      const calls = parseCalls(responseBody.calls);
      const answer = typeof responseBody.answer === "string" ? responseBody.answer : undefined;
      const model = typeof responseBody.model === "string" ? responseBody.model : undefined;
      const usageValue = responseBody.aiUsage;
      const usage = isRecord(usageValue) && typeof usageValue.used === "number"
        ? usageValue.used
        : null;
      if (usage !== null) setAiUsage(usage);

      if (!response.ok) {
        setResult(runId ? {
          runId,
          calls,
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
          Run a Baseten-powered agent against your active mock tools. Each call goes through the normal MockAgent gateway and appears in Execution Logs.
        </p>
      </CardHeader>
      <CardContent>
        {selectableTools.length === 0 ? (
          <p className="rounded-md bg-slate-50 p-4 text-sm text-slate-600">
            Create an active mock tool without API-key protection to run your first agent test.
          </p>
        ) : (
          <form onSubmit={runAgent} className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="mb-2 text-sm font-medium text-slate-800">
                Tools available to the agent ({selectedIds.length}/{MAX_PLAYGROUND_TOOLS})
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {tools.map((tool) => {
                  const unavailable = !tool.is_active || tool.require_api_key;
                  const checked = selectedIds.includes(tool.id);
                  return (
                    <label
                      key={tool.id}
                      className={`flex items-start gap-2 rounded-md border p-3 text-sm ${
                        unavailable ? "border-slate-100 bg-slate-50 text-slate-400" : "border-slate-200"
                      }`}
                      title={
                        !tool.is_active
                          ? "Enable this tool before using it in a run."
                          : tool.require_api_key
                            ? "API-key-protected tools are not yet supported in the Playground."
                            : undefined
                      }
                    >
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
                            ? !tool.is_active
                              ? "Disabled"
                              : "API key required"
                            : tool.description || "No description"}
                        </span>
                      </span>
                    </label>
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
                Maximum 5 mock calls per run. Each Baseten completion uses one monthly AI request. Prompts and tool results are sent to Baseten.
                {` Usage: ${aiUsage === null ? "unavailable" : `${aiUsage.toLocaleString()} / ${aiMonthlyRequestLimit.toLocaleString()}`}.`}
              </p>
              <Button type="submit" disabled={isRunning || !prompt.trim() || selectedIds.length === 0}>
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
              {result.model && <span>Model: {result.model}</span>}
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
