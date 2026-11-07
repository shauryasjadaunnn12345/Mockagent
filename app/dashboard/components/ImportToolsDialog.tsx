"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  createImportedTools,
  previewToolImportAction,
} from "@/app/actions/tools";
import { Button } from "@/components/ui/button";
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
import type { ImportedTool, ToolImportFormat } from "@/lib/tool-import";
import { Download } from "lucide-react";

const FORMAT_LABELS: Record<ToolImportFormat, string> = {
  openapi: "OpenAPI (JSON or YAML)",
  function_tools: "OpenAI / Anthropic tool definitions (JSON)",
  mcp_tools: "MCP tools/list result (JSON)",
  har: "Recorded traffic (HAR 1.2 JSON)",
};

const EXAMPLES: Record<ToolImportFormat, string> = {
  openapi: "Paste an OpenAPI document with paths and operations.",
  function_tools: 'Paste [{"type":"function","function":{"name":"lookup_order","description":"Find an order","parameters":{"type":"object","properties":{"order_id":{"type":"string"}},"required":["order_id"]}}}]',
  mcp_tools: 'Paste {"tools":[{"name":"lookup_order","description":"Find an order","inputSchema":{"type":"object","properties":{"order_id":{"type":"string"}},"required":["order_id"]}}]}',
  har: 'Paste an exported HAR 1.2 JSON document with log.entries request/response pairs.',
};

export function ImportToolsDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<ToolImportFormat>("openapi");
  const [source, setSource] = useState("");
  const [tools, setTools] = useState<ImportedTool[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function preview() {
    setError(null);
    setNotice(null);
    setTools([]);
    setSelected([]);
    startTransition(async () => {
      try {
        const result = await previewToolImportAction(format, source);
        if (!result.success) {
          setError(result.error);
          return;
        }
        setTools(result.tools);
        setSelected(result.tools.map((tool) => tool.name));
        if (result.tools.length > 0) {
          setNotice(`${result.tools.length} mock${result.tools.length === 1 ? "" : "s"} ready to preview.`);
        }
      } catch {
        setError("Could not preview this import. Check the pasted content and try again.");
      }
    });
  }

  function importSelected() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      try {
        const result = await createImportedTools(format, source, selected);
        if (!result.success) {
          setError(result.error);
          return;
        }
        setNotice(`Created ${result.count} mock${result.count === 1 ? "" : "s"}.`);
        setTools([]);
        setSelected([]);
        setSource("");
        router.refresh();
      } catch {
        setError("Could not create the imported mocks. Please try again.");
      }
    });
  }

  function toggleTool(name: string) {
    setSelected((current) =>
      current.includes(name)
        ? current.filter((value) => value !== name)
        : [...current, name]
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setError(null);
          setNotice(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline">
          <Download className="h-4 w-4" />
          Import tools
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import mock tools</DialogTitle>
          <DialogDescription>
            Paste a specification or exported HAR capture, preview the generated contracts, scenarios, and responses, then create the selected mocks. No upstream calls are made.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <label className="block space-y-1.5 text-sm font-medium text-slate-700" htmlFor="tool-import-format">
            Source format
            <select
              id="tool-import-format"
              className="block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              value={format}
              onChange={(event) => {
                setFormat(event.target.value as ToolImportFormat);
                setTools([]);
                setSelected([]);
                setNotice(null);
                setError(null);
              }}
            >
              {Object.entries(FORMAT_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="block space-y-1.5 text-sm font-medium text-slate-700" htmlFor="tool-import-source">
            Paste definition
            <Textarea
              id="tool-import-source"
              value={source}
              onChange={(event) => {
                setSource(event.target.value);
                setTools([]);
                setSelected([]);
                setNotice(null);
              }}
              maxLength={262_144}
              rows={9}
              placeholder={EXAMPLES[format]}
              spellCheck={false}
              className="font-mono text-xs"
            />
          </label>
          <p className="text-xs text-slate-500">
            Imports are limited to 256 KiB and 50 tools per pass. HAR imports accept up to 200 JSON exchanges; sensitive-name fields and authorization headers are omitted or redacted. Review captured payloads before creating mocks. OpenAPI local references are resolved; external references are never fetched.
          </p>
        </div>

        {error && <p role="alert" className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        {notice && <p role="status" className="rounded-md bg-emerald-50 p-2 text-sm text-emerald-800">{notice}</p>}

        {tools.length > 0 && (
          <section className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold">Preview ({tools.length})</h3>
              <button
                type="button"
                className="text-xs text-blue-700 underline"
                onClick={() => setSelected(selected.length === tools.length ? [] : tools.map((tool) => tool.name))}
              >
                {selected.length === tools.length ? "Select none" : "Select all"}
              </button>
            </div>
            {tools.map((tool) => (
              <details key={tool.name} className="rounded border border-slate-100 p-2">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Import ${tool.name}`}
                    checked={selected.includes(tool.name)}
                    onChange={() => toggleTool(tool.name)}
                  />
                  <span className="font-medium">{tool.name}</span>
                  {tool.description && <span className="truncate text-slate-500">{tool.description}</span>}
                  {tool.scenarios.length > 0 && (
                    <span className="ml-auto whitespace-nowrap text-xs text-blue-700">
                      {tool.scenarios.length} captured scenario{tool.scenarios.length === 1 ? "" : "s"}
                    </span>
                  )}
                </summary>
                <div className="mt-2 grid gap-2 md:grid-cols-2">
                  <pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">
                    {JSON.stringify(tool.jsonSchema, null, 2)}
                  </pre>
                  <pre className="overflow-auto rounded bg-slate-50 p-2 text-xs">
                    {JSON.stringify(tool.mockResponse, null, 2)}
                  </pre>
                </div>
                {tool.scenarios.length > 0 && (
                  <pre className="mt-2 overflow-auto rounded bg-blue-50 p-2 text-xs">
                    {JSON.stringify(tool.scenarios, null, 2)}
                  </pre>
                )}
              </details>
            ))}
          </section>
        )}

        <DialogFooter>
          {tools.length === 0 ? (
            <Button type="button" disabled={pending || !source.trim()} onClick={preview}>
              {pending ? "Preparing preview…" : "Preview import"}
            </Button>
          ) : (
            <Button type="button" disabled={pending || selected.length === 0} onClick={importSelected}>
              {pending ? "Creating mocks…" : `Create ${selected.length} mock${selected.length === 1 ? "" : "s"}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
