"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createTool } from "@/app/actions/tools";
import type { GeneratedToolDraft } from "@/lib/tool-definition";

export function AdvancedPanel({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState("A refund tool with user_id and reason enum");
  const [draft, setDraft] = useState<GeneratedToolDraft | null>(null);
  const [draftJson, setDraftJson] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  async function generateDraft() {
    setLoading(true);
    setError(null);
    setNotice(null);
    setDraft(null);
    setDraftJson("");

    try {
      const response = await fetch("/api/tools/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, workspaceId }),
      });
      const result: unknown = await response.json();
      const record = result && typeof result === "object"
        ? result as Record<string, unknown>
        : {};
      if (!response.ok) {
        throw new Error(
          typeof record.error === "string" ? record.error : "Tool generation failed."
        );
      }
      if (!record.draft || typeof record.draft !== "object" || Array.isArray(record.draft)) {
        throw new Error("Meta AI returned an invalid tool draft.");
      }

      const generatedDraft = record.draft as GeneratedToolDraft;
      setDraft(generatedDraft);
      setDraftJson(JSON.stringify(generatedDraft, null, 2));
      setModel(typeof record.model === "string" ? record.model : null);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Tool generation failed.");
    } finally {
      setLoading(false);
    }
  }

  async function saveDraft() {
    setError(null);
    setNotice(null);

    let parsedDraft: unknown;
    try {
      parsedDraft = JSON.parse(draftJson);
    } catch {
      setError("Draft must be valid JSON before it can be created.");
      return;
    }
    if (!parsedDraft || typeof parsedDraft !== "object" || Array.isArray(parsedDraft)) {
      setError("Draft must be a JSON object.");
      return;
    }

    const value = parsedDraft as Record<string, unknown>;
    if (
      typeof value.name !== "string" ||
      typeof value.description !== "string" ||
      !value.json_schema ||
      typeof value.json_schema !== "object" ||
      !value.mock_response ||
      typeof value.mock_response !== "object" ||
      !Array.isArray(value.scenarios)
    ) {
      setError("Draft must include a name, description, object schema, object response, and scenarios array.");
      return;
    }

    setSaving(true);
    try {
      const result = await createTool({
        name: value.name,
        description: value.description,
        jsonSchema: JSON.stringify(value.json_schema),
        mockResponse: JSON.stringify(value.mock_response),
        scenarios: JSON.stringify(value.scenarios),
        finalAnswerAssertions: "[]",
        semanticCriteria: "",
        requireApiKey: false,
      });
      if (!result.success) {
        setError(result.error ?? "Could not create the mock tool.");
        return;
      }

      setDraft(null);
      setDraftJson("");
      setNotice("Mock tool created. Find its endpoint in the Mock Tools section.");
      router.refresh();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create the mock tool.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div>
        <h2 className="font-semibold text-slate-900">Meta AI Tool Studio</h2>
        <p className="mt-1 text-sm text-slate-600">
          Describe a tool to generate a JSON Schema, mock response, and conditional scenarios.
          Review and edit the validated draft before adding it to this workspace.
        </p>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="sr-only" htmlFor="meta-tool-prompt">Describe the mock tool</label>
        <input
          id="meta-tool-prompt"
          className="min-w-0 flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
          value={prompt}
          maxLength={2000}
          onChange={(event) => setPrompt(event.currentTarget.value)}
          disabled={loading || saving}
          aria-describedby="meta-tool-prompt-help"
        />
        <button
          type="button"
          onClick={generateDraft}
          disabled={loading || saving || prompt.trim().length < 5}
          className="rounded bg-[#143d31] px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Generating…" : "Generate draft"}
        </button>
      </div>
      <p id="meta-tool-prompt-help" className="text-xs text-slate-500">
        Enter at least five characters. Meta output is a draft and is not saved until you review it and choose Create mock tool.
      </p>

      {loading && <p role="status" aria-live="polite" className="text-sm text-slate-600">Meta is drafting a tool from your description…</p>}
      {saving && <p role="status" aria-live="polite" className="text-sm text-slate-600">Saving the reviewed tool draft…</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
      {notice && <p role="status" className="text-sm text-emerald-700">{notice}</p>}

      {draft && (
        <div className="space-y-3">
          {model && <p className="text-xs text-slate-500">Generated with {model}</p>}
          <label
            className="block space-y-1.5 text-sm font-medium text-slate-800"
            htmlFor="meta-tool-draft"
          >
            Review and edit the generated tool
            <textarea
              id="meta-tool-draft"
              value={draftJson}
              onChange={(event) => setDraftJson(event.currentTarget.value)}
              spellCheck={false}
              rows={16}
              className="w-full rounded-md border border-slate-300 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100"
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Schema and scenario definitions are validated again when you create the tool.
            </p>
            <button
              type="button"
              onClick={saveDraft}
              disabled={saving}
              className="rounded bg-[#c9f36a] px-4 py-2 text-sm font-semibold text-[#142c25] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Creating…" : "Create mock tool"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
