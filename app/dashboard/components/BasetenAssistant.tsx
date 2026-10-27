"use client";

import { useState, type FormEvent } from "react";
import { Bot, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface BasetenAssistantProps {
  monthlyAIRequestsUsed: number | null;
  aiMonthlyRequestLimit: number;
}

export function BasetenAssistant({ monthlyAIRequestsUsed, aiMonthlyRequestLimit }: BasetenAssistantProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [aiUsage, setAiUsage] = useState(monthlyAIRequestsUsed);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isLoading) return;

    const nextMessages = [...messages, { role: "user" as const, content }];
    const requestMessages = nextMessages.slice(-20);
    while (
      requestMessages.length > 1 &&
      requestMessages.reduce((total, message) => total + message.content.length, 0) > 12_000
    ) {
      requestMessages.shift();
    }
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: requestMessages }),
      });
      const result: unknown = await response.json();
      if (!response.ok) {
        const message =
          result && typeof result === "object" && typeof (result as Record<string, unknown>).error === "string"
            ? (result as { error: string }).error
            : "The assistant request failed.";
        throw new Error(message);
      }

      const reply =
        result && typeof result === "object" && typeof (result as Record<string, unknown>).message === "string"
          ? (result as { message: string }).message
          : null;
      if (!reply) throw new Error("The assistant returned an invalid response.");

      const usageValue =
        result && typeof result === "object" ? (result as Record<string, unknown>).aiUsage : null;
      if (
        usageValue &&
        typeof usageValue === "object" &&
        typeof (usageValue as Record<string, unknown>).used === "number"
      ) {
        setAiUsage((usageValue as { used: number }).used);
      }
      setMessages([...nextMessages, { role: "assistant", content: reply }]);
      setDraft("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The assistant request failed.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Bot className="h-4 w-4" />
          MockAgent Assistant
        </CardTitle>
        <p className="text-sm text-slate-500">
          Ask for help designing mock tools, schemas, scenarios, or agent tests. Powered by Baseten Muse Spark Open.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          aria-live="polite"
          aria-label="Assistant conversation"
          className="max-h-[28rem] min-h-32 space-y-3 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-4"
        >
          {messages.length === 0 ? (
            <p className="text-sm text-slate-500">
              Try: “Help me design a mock tool for checking an order’s refund eligibility.”
            </p>
          ) : (
            messages.map((message, index) => (
              <div
                key={`${index}-${message.role}`}
                className={`max-w-[90%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  message.role === "user"
                    ? "ml-auto bg-slate-900 text-white"
                    : "mr-auto border border-slate-200 bg-white text-slate-800"
                }`}
              >
                {message.content}
              </div>
            ))
          )}
          {isLoading && <p className="text-sm text-slate-500">Baseten is thinking…</p>}
        </div>

        <form onSubmit={sendMessage} className="space-y-2">
          <label htmlFor="assistant-message" className="sr-only">
            Message the MockAgent Assistant
          </label>
          <Textarea
            id="assistant-message"
            value={draft}
            onChange={(event) => setDraft(event.currentTarget.value)}
            placeholder="Ask about building and testing your agent…"
            rows={3}
            maxLength={4000}
            disabled={isLoading}
            required
          />
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Messages are sent to Baseten. The assistant does not see your workspace data automatically.
              {` AI requests this month: ${aiUsage === null ? "unavailable" : `${aiUsage.toLocaleString()} / ${aiMonthlyRequestLimit.toLocaleString()}`}.`}
            </p>
            <Button type="submit" disabled={isLoading || !draft.trim()}>
              <Send className="h-4 w-4" />
              {isLoading ? "Sending…" : "Send"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
