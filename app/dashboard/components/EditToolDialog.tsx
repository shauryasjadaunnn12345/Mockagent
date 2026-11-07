"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Pencil, RotateCcw } from "lucide-react";
import {
  getToolRevisions,
  restoreToolRevision,
  updateTool,
  type ToolRevisionSummary,
} from "@/app/actions/tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import type { Tool } from "@/types/database";
import { ScenarioEditor } from "@/app/dashboard/components/ScenarioEditor";
import { compareToolRevision } from "@/lib/tool-revision-comparison";

interface EditToolDialogProps {
  tool: Tool;
}

function snapshotName(snapshot: ToolRevisionSummary["snapshot"]) {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const name = snapshot.name;
    return typeof name === "string" ? name : "Unnamed version";
  }
  return "Unnamed version";
}

export function EditToolDialog({ tool }: EditToolDialogProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [revisions, setRevisions] = useState<ToolRevisionSummary[]>([]);
  const [comparisonRevisionId, setComparisonRevisionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function openEditor(nextOpen: boolean) {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await getToolRevisions(tool.id);
      if (result.success) {
        setRevisions(result.revisions);
        setComparisonRevisionId(null);
      }
      else setError(result.error);
    });
  }

  function save(formData: FormData) {
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await updateTool(tool.id, tool.updated_at, {
        name: String(formData.get("name") ?? ""),
        description: String(formData.get("description") ?? ""),
        jsonSchema: String(formData.get("jsonSchema") ?? ""),
        mockResponse: String(formData.get("mockResponse") ?? ""),
        scenarios: String(formData.get("scenarios") ?? ""),
        finalAnswerAssertions: String(formData.get("finalAnswerAssertions") ?? ""),
        semanticCriteria: String(formData.get("semanticCriteria") ?? ""),
      });
      if (!result.success) {
        setError(result.error ?? "Could not update the tool.");
        return;
      }
      setMessage("Tool updated. The previous configuration was saved to revision history.");
      setOpen(false);
      router.refresh();
    });
  }

  function restore(revision: ToolRevisionSummary) {
    if (!confirm(`Restore "${snapshotName(revision.snapshot)}"? The current configuration will be saved as a new revision.`)) {
      return;
    }
    setError(null);
    setMessage(null);
    startTransition(async () => {
      const result = await restoreToolRevision(tool.id, revision.id, tool.updated_at);
      if (!result.success) {
        setError(result.error ?? "Could not restore that revision.");
        return;
      }
      setMessage("Revision restored. The previous configuration was saved to history.");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={openEditor}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Pencil className="h-4 w-4" />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit {tool.name}</DialogTitle>
          <DialogDescription>
            Changes apply to the existing endpoint. Before each configuration edit, the prior version is kept in revision history.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <form action={save} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor={`tool-name-${tool.id}`}>Tool name</Label>
              <Input id={`tool-name-${tool.id}`} name="name" defaultValue={tool.name} maxLength={100} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`tool-description-${tool.id}`}>Description</Label>
              <Input id={`tool-description-${tool.id}`} name="description" defaultValue={tool.description ?? ""} maxLength={1000} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`tool-schema-${tool.id}`}>Expected JSON Schema</Label>
              <Textarea id={`tool-schema-${tool.id}`} name="jsonSchema" defaultValue={JSON.stringify(tool.json_schema, null, 2)} rows={7} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`tool-response-${tool.id}`}>Default mock response</Label>
              <Textarea id={`tool-response-${tool.id}`} name="mockResponse" defaultValue={JSON.stringify(tool.mock_response, null, 2)} rows={4} required />
            </div>
            <ScenarioEditor name="scenarios" idPrefix={`tool-${tool.id}-scenarios`} value={tool.scenarios} />
            <div className="space-y-1.5">
              <Label htmlFor={`tool-assertions-${tool.id}`}>Run &amp; final-answer assertions</Label>
              <Textarea
                id={`tool-assertions-${tool.id}`}
                name="finalAnswerAssertions"
                defaultValue={JSON.stringify(tool.final_answer_assertions, null, 2)}
                placeholder={`[
  { "name": "Require refund confirmation", "type": "call_guard", "path": "/confirmed", "operator": "equals", "value": true, "message": "Refunds require explicit confirmation." },
  { "name": "Refund amount ceiling", "type": "call_guard", "path": "/amount", "operator": "lte", "value": 500, "message": "Refund amount exceeds the configured limit." }
]`}
                rows={7}
                required
              />
              <p className="text-xs text-slate-500">
                <code>call_guard</code> rules block unsafe arguments before the mock executes and record a policy violation. JSON Pointer paths support <code>exists</code>, <code>equals</code>, <code>not_equals</code>, <code>lte</code>, and <code>gte</code>.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`tool-semantic-${tool.id}`}>Semantic QA criteria</Label>
              <Textarea id={`tool-semantic-${tool.id}`} name="semanticCriteria" defaultValue={tool.semantic_criteria ?? ""} maxLength={2000} rows={3} />
            </div>
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <DialogFooter>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : "Save changes"}
              </Button>
            </DialogFooter>
          </form>

          <aside className="space-y-2 border-t border-slate-200 pt-4 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <History className="h-4 w-4" />
              Revision history
            </h3>
            <p className="text-xs text-slate-500">The latest 50 prior configurations are retained.</p>
            {isPending && revisions.length === 0 ? (
              <p role="status" aria-live="polite" className="text-xs text-slate-500">Loading revision history…</p>
            ) : revisions.length === 0 ? (
              <p className="text-xs text-slate-500">No prior edits yet.</p>
            ) : (
              <ul className="max-h-96 space-y-2 overflow-y-auto">
                {revisions.map((revision) => (
                  <li key={revision.id} className="rounded-md border border-slate-200 p-2">
                    <p className="truncate text-sm font-medium text-slate-800">{snapshotName(revision.snapshot)}</p>
                    <time className="block text-xs text-slate-500" dateTime={revision.created_at}>
                      {new Date(revision.created_at).toLocaleString()}
                    </time>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        aria-pressed={comparisonRevisionId === revision.id}
                        onClick={() => setComparisonRevisionId((current) =>
                          current === revision.id ? null : revision.id
                        )}
                      >
                        {comparisonRevisionId === revision.id ? "Hide comparison" : "Compare"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={isPending}
                        onClick={() => restore(revision)}
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        Restore
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {comparisonRevisionId && (() => {
              const revision = revisions.find((item) => item.id === comparisonRevisionId);
              if (!revision) return null;
              const differences = compareToolRevision(revision.snapshot, {
                name: tool.name,
                description: tool.description,
                json_schema: tool.json_schema,
                mock_response: tool.mock_response,
                scenarios: tool.scenarios,
                final_answer_assertions: tool.final_answer_assertions,
                semantic_criteria: tool.semantic_criteria,
              });
              return (
                <div className="space-y-2 rounded-md border border-violet-200 bg-violet-50 p-2">
                  <p className="text-xs font-semibold text-slate-800">
                    Revision → current configuration ({differences?.length ?? 0} changed fields)
                  </p>
                  {differences === null ? (
                    <p className="text-xs text-amber-800">This revision snapshot is not in a comparable format.</p>
                  ) : differences.length === 0 ? (
                    <p className="text-xs text-slate-600">No differences from the current configuration.</p>
                  ) : (
                    <ul className="max-h-72 space-y-2 overflow-y-auto">
                      {differences.map((difference) => (
                        <li key={difference.key} className="space-y-1 rounded bg-white p-2 text-xs">
                          <p className="font-medium text-slate-800">{difference.label}</p>
                          <div className="grid gap-2 lg:grid-cols-2">
                            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-red-50 p-1 text-red-800">
                              Revision: {difference.previous}
                            </pre>
                            <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-emerald-50 p-1 text-emerald-800">
                              Current: {difference.current}
                            </pre>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })()}
          </aside>
        </div>
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}
