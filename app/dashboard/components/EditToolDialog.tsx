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
      if (result.success) setRevisions(result.revisions);
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
      <DialogContent className="max-w-3xl">
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
            <div className="space-y-1.5">
              <Label htmlFor={`tool-scenarios-${tool.id}`}>Conditional scenarios</Label>
              <Textarea id={`tool-scenarios-${tool.id}`} name="scenarios" defaultValue={JSON.stringify(tool.scenarios, null, 2)} rows={7} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`tool-assertions-${tool.id}`}>Run &amp; final-answer assertions</Label>
              <Textarea id={`tool-assertions-${tool.id}`} name="finalAnswerAssertions" defaultValue={JSON.stringify(tool.final_answer_assertions, null, 2)} rows={5} required />
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
            {revisions.length === 0 ? (
              <p className="text-xs text-slate-500">No prior edits yet.</p>
            ) : (
              <ul className="max-h-96 space-y-2 overflow-y-auto">
                {revisions.map((revision) => (
                  <li key={revision.id} className="rounded-md border border-slate-200 p-2">
                    <p className="truncate text-sm font-medium text-slate-800">{snapshotName(revision.snapshot)}</p>
                    <time className="block text-xs text-slate-500" dateTime={revision.created_at}>
                      {new Date(revision.created_at).toLocaleString()}
                    </time>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-2"
                      disabled={isPending}
                      onClick={() => restore(revision)}
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
        {message && <p role="status" className="text-sm text-emerald-700">{message}</p>}
      </DialogContent>
    </Dialog>
  );
}
