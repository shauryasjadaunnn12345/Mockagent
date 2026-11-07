"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteToolset, setToolsetAuthMode } from "@/app/actions/tools";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Copy, RotateCw, Shield } from "lucide-react";

interface McpConnectPanelProps {
  toolsetId: string;
  toolsetName: string;
  workspaceSlug: string;
  toolsetSlug: string;
  accessMode: "api_key" | "open";
  appUrl: string;
}

export function McpConnectPanel({
  toolsetId,
  toolsetName,
  workspaceSlug,
  toolsetSlug,
  accessMode: initialAccessMode,
  appUrl,
}: McpConnectPanelProps) {
  const router = useRouter();
  const [accessMode, setAccessMode] = useState(initialAccessMode);
  const [openToken, setOpenToken] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const baseUrl = useMemo(
    () => `${appUrl.replace(/\/$/, "")}/api/mcp/${encodeURIComponent(workspaceSlug)}/${encodeURIComponent(toolsetSlug)}`,
    [appUrl, workspaceSlug, toolsetSlug]
  );
  const endpointUrl = accessMode === "open" && openToken
    ? `${baseUrl}?token=${encodeURIComponent(openToken)}`
    : baseUrl;
  const cursorAuthorization = "Bearer ${env:MOCKAGENT_API_KEY}";
  const vscodeAuthorization = "Bearer ${env:MOCKAGENT_API_KEY}";
  const secretOnlyOnce = accessMode === "open" && !openToken;

  function setAuth(nextMode: "api_key" | "open") {
    setError(null);
    startTransition(async () => {
      const response = await setToolsetAuthMode(toolsetId, nextMode);
      if (!response.success) {
        setError(response.error);
        return;
      }
      setAccessMode(nextMode);
      setOpenToken(response.token ?? null);
      router.refresh();
    });
  }

  async function copyUrl() {
    await navigator.clipboard.writeText(endpointUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function remove() {
    if (!confirm(`Delete the "${toolsetName}" toolset? Existing execution logs will be retained.`)) return;
    startTransition(async () => {
      const response = await deleteToolset(toolsetId);
      if (!response.success) {
        setError(response.error ?? "Could not delete the toolset.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  const claudeConfig = accessMode === "api_key"
    ? `claude mcp add --transport http mockagent "${baseUrl}" --header "Authorization: Bearer $MOCKAGENT_API_KEY"`
    : `claude mcp add --transport http mockagent "${endpointUrl}"`;
  const clients = [
    {
      name: "Claude Code",
      detail: "Verified remote HTTP syntax from Claude Code MCP docs.",
      snippet: claudeConfig,
    },
    {
      name: "Cursor",
      detail: "Verified remote URL, headers, and environment interpolation in Cursor's MCP docs.",
      snippet: JSON.stringify({
        mcpServers: {
          mockagent: {
            url: endpointUrl,
            ...(accessMode === "api_key" ? { headers: { Authorization: cursorAuthorization } } : {}),
          },
        },
      }, null, 2),
    },
    {
      name: "VS Code",
      detail: "Verified .vscode/mcp.json HTTP headers and environment variables in the VS Code MCP reference.",
      snippet: JSON.stringify({
        servers: {
          mockagent: {
            type: "http",
            url: endpointUrl,
            ...(accessMode === "api_key" ? { headers: { Authorization: vscodeAuthorization } } : {}),
          },
        },
      }, null, 2),
    },
    {
      name: "Generic HTTP JSON",
      detail: "Portable mcpServers configuration. Check your client's config path and auth support.",
      snippet: JSON.stringify({
        mcpServers: {
          mockagent: {
            type: "http",
            url: endpointUrl,
            ...(accessMode === "api_key" ? { headers: { Authorization: "Bearer <WORKSPACE_API_KEY>" } } : {}),
          },
        },
      }, null, 2),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Shield className="h-4 w-4" /> Connect via MCP
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-slate-600">
          Add this stateless HTTP endpoint to an MCP client. Calls still respect each tool&apos;s API-key requirement.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant={accessMode === "api_key" ? "default" : "outline"}
            disabled={pending}
            onClick={() => setAuth("api_key")}
          >
            Workspace API key
          </Button>
          <Button
            type="button"
            size="sm"
            variant={accessMode === "open" ? "default" : "outline"}
            disabled={pending}
            onClick={() => setAuth("open")}
          >
            {accessMode === "open" ? <RotateCw className="mr-1 h-4 w-4" /> : null}
            {accessMode === "open" ? (openToken ? "Rotate open URL token" : "Reveal fresh open URL token") : "Open URL token"}
          </Button>
        </div>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {accessMode === "open" && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            The URL token is a bearer secret. It is shown only when created; rotate it to get a new URL if it is lost. Existing tool-level API-key requirements still apply.
          </p>
        )}
        {!secretOnlyOnce && (
          <div className="flex min-w-0 items-center gap-2 rounded-md bg-slate-100 px-3 py-2">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-slate-700">{endpointUrl}</code>
            <Button type="button" size="sm" variant="outline" onClick={copyUrl}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy URL"}
            </Button>
          </div>
        )}
        {accessMode === "api_key" && (
          <p className="text-xs text-slate-500">
            Set <code>MOCKAGENT_API_KEY</code> in the MCP client&apos;s environment to a workspace API key.
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {clients.map((client) => (
            <section key={client.name} className="min-w-0 rounded-md border border-slate-200 p-3">
              <h3 className="text-sm font-semibold text-slate-800">{client.name}</h3>
              <p className="mt-1 text-xs text-slate-500">{client.detail}</p>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded bg-slate-950 p-3 text-xs text-slate-100">
                {secretOnlyOnce ? "Rotate the URL token to reveal the configured endpoint snippet." : client.snippet}
              </pre>
            </section>
          ))}
        </div>
        <div className="border-t border-slate-200 pt-4">
          <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={remove}>
            Delete toolset
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
