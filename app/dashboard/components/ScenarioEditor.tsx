"use client";

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseScenarios, resolveScenario, resolveScenarioResponse } from "@/lib/scenarios";
import { validateSchemaDefinition } from "@/lib/validators";

interface ScenarioDraft {
  id: number;
  name: string;
  match: string;
  response: string;
  responses: string;
  isSequence: boolean;
}

interface ScenarioEditorProps {
  name: string;
  idPrefix: string;
  value: unknown;
}

function createDraft(value?: unknown, id = 0): ScenarioDraft {
  const record = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const sequence = Array.isArray(record.responses);
  return {
    id,
    name: typeof record.name === "string" ? record.name : "",
    match: JSON.stringify(record.match ?? { type: "object" }, null, 2),
    response: JSON.stringify(record.response ?? {}, null, 2),
    responses: JSON.stringify(record.responses ?? [{}], null, 2),
    isSequence: sequence,
  };
}

function readInitialDrafts(value: unknown): ScenarioDraft[] {
  if (!Array.isArray(value)) return [];
  return value.map((scenario, index) => createDraft(scenario, index + 1));
}

function serializeDrafts(drafts: ScenarioDraft[]): string {
  return JSON.stringify(drafts.map((draft) => {
    let match: unknown;
    let response: unknown;
    let responses: unknown;
    try { match = JSON.parse(draft.match); } catch { match = draft.match; }
    try { response = JSON.parse(draft.response); } catch { response = draft.response; }
    try { responses = JSON.parse(draft.responses); } catch { responses = draft.responses; }
    return {
      name: draft.name,
      match,
      ...(draft.isSequence ? { responses } : { response }),
    };
  }));
}

export function ScenarioEditor({ name, idPrefix, value }: ScenarioEditorProps) {
  const [drafts, setDrafts] = useState(() => readInitialDrafts(value));
  const [sampleInput, setSampleInput] = useState('{\n  "user_id": "vip"\n}');
  const [previewStep, setPreviewStep] = useState(1);
  const [preview, setPreview] = useState<string | null>(null);
  const scenariosJson = useMemo(() => serializeDrafts(drafts), [drafts]);

  function updateDraft(id: number, patch: Partial<ScenarioDraft>) {
    setDrafts((current) => current.map((draft) =>
      draft.id === id ? { ...draft, ...patch } : draft
    ));
    setPreview(null);
  }

  function previewScenario() {
    setPreview(null);
    let payload: unknown;
    try {
      payload = JSON.parse(sampleInput);
    } catch {
      setPreview("Sample input is not valid JSON.");
      return;
    }

    try {
      const scenarios = parseScenarios(JSON.parse(scenariosJson));
      for (const [index, scenario] of scenarios.entries()) {
        const schemaError = validateSchemaDefinition(scenario.match);
        if (schemaError) throw new Error(`Scenario ${index + 1} has an invalid match schema: ${schemaError}`);
      }
      const match = resolveScenario(scenarios, payload);
      if (!match) {
        setPreview("No scenario matches this input. The tool's default response will be used.");
        return;
      }
      const step = match.responses
        ? Math.min(Math.max(previewStep, 1), match.responses.length)
        : 1;
      const response = resolveScenarioResponse(match, previewStep);
      setPreview(`Matched "${match.name}" (previewing response ${step}):\n${JSON.stringify(response, null, 2)}`);
    } catch (error) {
      setPreview(error instanceof Error ? error.message : "Scenario configuration is invalid.");
    }
  }

  return (
    <div className="space-y-3">
      <input type="hidden" name={name} value={scenariosJson} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label>Conditional scenarios</Label>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setDrafts((current) => [
            ...current,
            createDraft(undefined, Math.max(0, ...current.map((draft) => draft.id)) + 1),
          ])}
        >
          <Plus className="h-4 w-4" /> Add scenario
        </Button>
      </div>
      <p className="text-xs text-slate-500">
        Scenarios are checked in order; the first matching JSON Schema wins. Use a single response or a response sequence.
      </p>
      {drafts.length === 0 && (
        <p className="rounded border border-dashed p-3 text-xs text-slate-500">
          No scenarios configured. Valid calls will use the default response.
        </p>
      )}
      {drafts.map((draft, index) => (
        <fieldset key={draft.id} className="space-y-2 rounded-md border border-slate-200 p-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Scenario {index + 1}</span>
            <Input
              aria-label={`Scenario ${index + 1} name`}
              value={draft.name}
              onChange={(event) => updateDraft(draft.id, { name: event.currentTarget.value })}
              maxLength={100}
              placeholder="VIP customer"
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label={`Remove scenario ${index + 1}`}
              onClick={() => setDrafts((current) => current.filter((item) => item.id !== draft.id))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="space-y-1 text-xs font-medium text-slate-700">
              Match JSON Schema
              <Textarea
                aria-label={`Scenario ${index + 1} match schema`}
                value={draft.match}
                onChange={(event) => updateDraft(draft.id, { match: event.currentTarget.value })}
                spellCheck={false}
                rows={6}
                className="font-mono text-xs"
              />
            </label>
            <label className="space-y-1 text-xs font-medium text-slate-700">
              {draft.isSequence ? "Response sequence (JSON array)" : "Response (JSON object)"}
              <Textarea
                aria-label={`Scenario ${index + 1} response`}
                value={draft.isSequence ? draft.responses : draft.response}
                onChange={(event) => updateDraft(draft.id, draft.isSequence
                  ? { responses: event.currentTarget.value }
                  : { response: event.currentTarget.value })}
                spellCheck={false}
                rows={6}
                className="font-mono text-xs"
              />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input
              type="checkbox"
              checked={draft.isSequence}
              onChange={(event) => updateDraft(draft.id, { isSequence: event.currentTarget.checked })}
            />
            Use ordered response sequence
          </label>
        </fieldset>
      ))}
      <div className="space-y-2 rounded-md bg-slate-50 p-3">
        <Label htmlFor={`${idPrefix}-preview-input`}>Try a sample input</Label>
        <Textarea
          id={`${idPrefix}-preview-input`}
          value={sampleInput}
          onChange={(event) => setSampleInput(event.currentTarget.value)}
          spellCheck={false}
          rows={3}
          className="font-mono text-xs"
        />
        <div className="flex flex-wrap items-end gap-2">
          <label className="space-y-1 text-xs text-slate-600">
            Sequence step
            <Input
              type="number"
              min={1}
              max={100}
              value={previewStep}
              onChange={(event) => setPreviewStep(Math.max(1, Number(event.currentTarget.value) || 1))}
              className="w-24"
            />
          </label>
          <Button type="button" size="sm" variant="outline" onClick={previewScenario}>
            Preview scenario match
          </Button>
        </div>
        {preview && (
          <pre
            role="status"
            className={`max-h-48 overflow-auto whitespace-pre-wrap rounded p-2 text-xs ${
              preview.startsWith("No scenario") || preview.startsWith("Matched")
                ? "bg-emerald-50 text-emerald-800"
                : "bg-amber-50 text-amber-800"
            }`}
          >
            {preview}
          </pre>
        )}
      </div>
    </div>
  );
}
