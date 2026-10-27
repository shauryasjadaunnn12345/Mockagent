"use client";

import { useState, type FormEvent } from "react";
import { Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { resolveScenario, resolveScenarioResponse } from "@/lib/scenarios";
import { validateAgainstSchema } from "@/lib/validators";

const expectedSchema = {
  type: "object",
  properties: {
    user_id: { type: "string" },
    reason: { type: "string" },
  },
  required: ["user_id"],
};

const scenarios = [
  {
    name: "VIP user",
    match: {
      type: "object",
      properties: { user_id: { const: "vip" } },
      required: ["user_id"],
    },
    response: {
      success: true,
      message: "VIP refund processed.",
    },
  },
];

const defaultResponse = {
  success: true,
  message: "Refund processed.",
};

const initialInput = JSON.stringify(
  { user_id: "vip", reason: "duplicate" },
  null,
  2
);

interface DemoResult {
  status: "SUCCESS" | "SCHEMA ERROR";
  scenario: string | null;
  output: unknown;
}

function runDemo(input: string): DemoResult {
  let payload: unknown;
  try {
    payload = JSON.parse(input);
  } catch {
    return {
      status: "SCHEMA ERROR",
      scenario: null,
      output: {
        error_code: "INVALID_JSON",
        message: "Request body must be valid JSON.",
      },
    };
  }

  const validation = validateAgainstSchema(expectedSchema, payload);
  if (!validation.valid) {
    return {
      status: "SCHEMA ERROR",
      scenario: null,
      output: {
        error_code: "SCHEMA_VALIDATION_FAILED",
        message: "The provided arguments do not match the expected schema.",
        errors: validation.errors?.map(({ instancePath, keyword, message }) => ({
          path: instancePath || "/",
          keyword,
          message,
        })),
      },
    };
  }

  const matchedScenario = resolveScenario(scenarios, payload);
  return {
    status: "SUCCESS",
    scenario: matchedScenario?.name ?? null,
    output: matchedScenario
      ? resolveScenarioResponse(matchedScenario)
      : defaultResponse,
  };
}

export function InteractiveToolDemo() {
  const [input, setInput] = useState(initialInput);
  const [result, setResult] = useState<DemoResult>(() => runDemo(initialInput));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setResult(runDemo(input));
  }

  const isSuccess = result.status === "SUCCESS";

  return (
    <div className="bg-[#172b25] p-4 text-[#dbe7d9] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase text-[#91a79b]">Interactive demo</p>
          <h3 className="mt-1 text-sm font-semibold text-white">Try a tool call</h3>
        </div>
        <span className="rounded-md border border-[#496459] px-2 py-1 font-mono text-[10px] text-[#b2c8b8]">
          BROWSER ONLY
        </span>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 space-y-3">
        <label htmlFor="demo-input" className="block text-[11px] font-medium text-[#a9c0b0]">
          Input JSON
        </label>
        <Textarea
          id="demo-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          spellCheck={false}
          className="min-h-28 border-[#496459] bg-[#10221c] text-xs leading-5 text-[#d8e7d2] focus-visible:ring-[#9bc7a6]"
          aria-label="Tool call input JSON"
        />
        <Button
          type="submit"
          className="h-9 bg-[#c9f36a] text-xs font-semibold text-[#17382c] hover:bg-[#b9e65a]"
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          Run example
        </Button>
      </form>

      <div className="mt-5 border-t border-[#334b40] pt-4" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-semibold uppercase text-[#91a79b]">Output</p>
          <span
            className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
              isSuccess
                ? "bg-[#d9f0db] text-[#36714c]"
                : "bg-[#fae6d4] text-[#9a592d]"
            }`}
          >
            {result.status}
          </span>
        </div>
        {isSuccess && (
          <p className="mt-2 text-[11px] text-[#a9c0b0]">
            {result.scenario ? `Matched scenario: ${result.scenario}` : "Default mock response"}
          </p>
        )}
        <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-[#334b40] bg-[#10221c] p-3 font-mono text-xs leading-5 text-[#d9ef83]">
          <code>{JSON.stringify(result.output, null, 2)}</code>
        </pre>
        <p className="mt-3 text-[10px] leading-4 text-[#a9c0b0]">
          Runs locally in your browser with the sample schema and responses. It does not call a live endpoint.
        </p>
      </div>
    </div>
  );
}
