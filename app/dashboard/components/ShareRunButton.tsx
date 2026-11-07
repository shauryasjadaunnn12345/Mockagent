"use client";

import { useState } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ShareRunButton({ runRecordId }: { runRecordId: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  async function copyLink() {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/dashboard/runs/${encodeURIComponent(runRecordId)}`
      );
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("MockAgent: failed to copy regression run link", error);
      setCopyError("Could not copy the link. Check clipboard permissions and try again.");
    }
  }

  return (
    <div className="space-y-1">
      <Button type="button" size="sm" variant="outline" onClick={copyLink}>
        {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />}
        {copied ? "Link copied" : "Share run"}
        <Copy className="h-3.5 w-3.5" />
      </Button>
      {copyError && <p role="alert" className="text-xs text-red-700">{copyError}</p>}
    </div>
  );
}
