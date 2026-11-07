"use client";

import { useState, useTransition } from "react";
import {
  previewToolImportAction,
} from "@/app/actions/tools";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { compareToolContracts, type ToolDriftFinding } from "@/lib/tool-drift";
import type { ToolImportFormat } from "@/lib/tool-import";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GitCompareArrows } from "lucide-react";

interface ToolDriftDialogProps {
  tools: Array<{
    id: string;
    name: string;
    description: string | null;
    json_schema: unknown;
  }>;
}

const SPEC_FORMATS: Array<{ value: ToolImportFormat; label: string }> = [
  { value: "openapi", label: "OpenAPI (JSON or YAML)" },
  { value: "function_tools", label: "OpenAI / Anthropic function tools" },
  { value: "mcp_tools", label: "MCP tools/list JSON" },
];

function findingText(finding: ToolDriftFinding): string {
  if (finding.kind === "missing_spec") return "Mock tool is missing from this specification.";
  if (finding.kind === "missing_mock") return "Specification defines a tool with no matching mock.";
  if (finding.kind === "description") return "Tool description differs.";
  return "Input schema differs.";
}

function formatValue(value: unknown): string {
  if (value === undefined) return "(missing)";
  const json = JSON.stringify(value);
  return json.length > 240 ? `${json.slice(0, 237)}...` : json;
}

export function ToolDriftDialog({ tools }: ToolDriftDialogProps) {
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ToolImportFormat>("openapi");
  const [source, setSource] = useState("");
  const [findings, setFindings] = useState<ToolDriftFinding[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function compare() {
    setError(null);
    setFindings(null);
    startTransition(async () => {
      const result = await previewToolImportAction(format, source);
      if (!result.success) {
        setError(result.error);
        return;
      }
      try {
        setFindings(compareToolContracts(tools, result.tools));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not compare the contracts.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen);
      if (!nextOpen) {
        setError(null);
        setFindings(null);
      }
    }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <GitCompareArrows className="h-4 w-4" />
          Check API drift
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Check mock contracts against a specification</DialogTitle>
          <DialogDescription>
            Paste the current API spec to compare its tool names, descriptions, and input schemas with this workspace&apos;s mocks. The spec is parsed locally by MockAgent&apos;s import flow; no external URL is fetched.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm font-medium text-slate-700" htmlFor="drift-spec-format">
            Specification format
            <select
              id="drift-spec-format"
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={format}
              onChange={(event) => {
                setFormat(event.target.value as ToolImportFormat);
                setFindings(null);
                setError(null);
              }}
            >
              {SPEC_FORMATS.map(({ value, label }) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700" htmlFor="drift-spec-source">
            Current specification
            <Textarea
              id="drift-spec-source"
              value={source}
              onChange={(event) => {
                setSource(event.currentTarget.value);
                setFindings(null);
              }}
              maxLength={262_144}
              rows={10}
              placeholder="Paste an OpenAPI document or supported function/MCP tool definitions."
              spellCheck={false}
              className="font-mono text-xs"
            />
          </label>
          <Button type="button" onClick={compare} disabled={pending || tools.length === 0 || !source.trim()}>
            {pending ? "Comparing…" : "Compare with saved mocks"}
          </Button>
          {tools.length === 0 && <p className="text-sm text-amber-800">Create at least one mock tool before checking drift.</p>}
        </div>

        {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        {findings !== null && (
          <section aria-live="polite" className="space-y-2 rounded-md border border-slate-200 p-3">
            <h3 className={`text-sm font-semibold ${findings.length ? "text-amber-900" : "text-emerald-800"}`}>
              {findings.length
                ? `${findings.length} difference${findings.length === 1 ? "" : "s"} found`
                : "No drift found"}
            </h3>
            <p className="text-xs text-slate-600">
              Matched by exact tool name. This is a point-in-time comparison; paste a new spec to check again. MockAgent does not poll upstream APIs.
            </p>
            {findings.length > 0 && (
              <ul className="max-h-72 space-y-2 overflow-y-auto">
                {findings.map((finding, index) => (
                  <li key={`${finding.toolName}-${finding.path}-${index}`} className="rounded border border-amber-100 bg-amber-50/60 p-2 text-xs">
                    <p className="font-semibold text-slate-800">{finding.toolName} · {findingText(finding)}</p>
                    <code className="mt-1 block break-all text-slate-600">{finding.path}</code>
                    {"expected" in finding && (
                      <p className="mt-1 break-all text-slate-600">
                        Spec: <code>{formatValue(finding.expected)}</code> · Mock: <code>{formatValue(finding.actual)}</code>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </DialogContent>
    </Dialog>
  );
}
