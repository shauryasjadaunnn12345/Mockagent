"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createApiKey, revokeApiKey, type ApiKeySummary } from "@/app/actions/tools";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Check, Copy, KeyRound, Trash2 } from "lucide-react";

interface ApiKeysPanelProps {
  apiKeys: ApiKeySummary[];
  maxMonthlyCalls: number;
}

export function ApiKeysPanel({ apiKeys, maxMonthlyCalls }: ApiKeysPanelProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function handleCreate(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await createApiKey(
        String(formData.get("name") ?? ""),
        Number(formData.get("monthlyLimit") ?? 10000)
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      setCreatedKey(result.key);
      router.refresh();
    });
  }

  function handleRevoke(keyId: string) {
    startTransition(async () => {
      const result = await revokeApiKey(keyId);
      if (!result.success) setError(result.error ?? "Could not revoke key.");
      else router.refresh();
    });
  }

  async function copyKey() {
    if (!createdKey) return;
    await navigator.clipboard.writeText(createdKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <KeyRound className="h-4 w-4" /> API Keys
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-slate-500">
          Keys are shown once. Send them as an Authorization Bearer token when calling tools that require authentication.
        </p>
        {error && <p className="text-sm text-red-700">{error}</p>}
        {createdKey && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-xs text-slate-800">{createdKey}</code>
            <Button type="button" size="sm" variant="outline" onClick={copyKey}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        )}

        <form action={handleCreate} className="grid gap-3 sm:grid-cols-[1fr_160px_auto] sm:items-end">
          <div className="space-y-1.5">
            <Label htmlFor="api-key-name">Key name</Label>
            <Input id="api-key-name" name="name" placeholder="Production agent" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="api-key-limit">Monthly calls</Label>
            <Input id="api-key-limit" name="monthlyLimit" type="number" min="1" max={maxMonthlyCalls} defaultValue={maxMonthlyCalls} required />
          </div>
          <Button type="submit" disabled={isPending}>Create key</Button>
        </form>

        {apiKeys.length > 0 && (
          <ul className="divide-y divide-slate-200 border-y border-slate-200">
            {apiKeys.map((apiKey) => (
              <li key={apiKey.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800">{apiKey.name}</p>
                  <p className="font-mono text-xs text-slate-500">{apiKey.key_prefix}... · {apiKey.monthly_limit.toLocaleString()} calls/month</p>
                </div>
                <Button type="button" variant="ghost" size="icon" disabled={isPending} onClick={() => handleRevoke(apiKey.id)} aria-label={`Revoke ${apiKey.name}`}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
