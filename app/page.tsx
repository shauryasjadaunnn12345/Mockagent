import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CircleDot,
  Clock3,
  Code2,
  Download,
  KeyRound,
  Play,
  ShieldCheck,
  Sparkles,
  Waypoints,
  Workflow,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { InteractiveToolDemo } from "@/app/InteractiveToolDemo";

const capabilities = [
  {
    number: "01",
    icon: Braces,
    title: "Make the contract explicit",
    text: "Define the arguments your tool accepts with JSON Schema. Invalid calls come back with specific errors your agent can correct.",
    detail: "SCHEMA VALIDATION",
  },
  {
    number: "02",
    icon: Workflow,
    title: "Exercise more than the happy path",
    text: "Match inputs to named scenarios, sequence changing responses, and schedule deterministic transient failures to exercise retries.",
    detail: "CONDITIONAL RESPONSES",
  },
  {
    number: "03",
    icon: Play,
    title: "Replay and compare",
    text: "Replay a saved successful call against the current mock. See whether a prompt, schema, or response change altered the result.",
    detail: "REGRESSION CHECKS",
  },
  {
    number: "04",
    icon: ShieldCheck,
    title: "Protect the endpoint",
    text: "Issue revocable bearer keys, require them per tool, and enforce monthly usage limits at the gateway.",
    detail: "API KEY CONTROLS",
  },
  {
    number: "05",
    icon: Sparkles,
    title: "Draft tools with Muse Spark",
    text: "Turn a plain-language requirement into an editable tool contract, mock response, and edge-case scenarios. Validate before saving.",
    detail: "META AI TOOL STUDIO",
  },
  {
    number: "06",
    icon: Waypoints,
    title: "Connect over MCP",
    text: "Expose a workspace toolset through a hosted MCP URL with API-key or token-based access.",
    detail: "HOSTED MCP",
  },
];

const featureGroups = [
  {
    icon: Braces,
    title: "Create, validate, and version mock tools",
    description: "Define the tool contract, predictable response, access policy, and revisions in one workspace.",
    features: [
      { name: "Tool authoring", text: "Create tools with a name, description, JSON Schema input contract, JSON response, scenarios, and optional per-tool API-key protection." },
      { name: "HTTP mock endpoints", text: "Give each tool a stable HTTPS endpoint; GET describes the tool and POST executes a mock call." },
      { name: "Actionable validation", text: "Validate required fields, types, enums, formats, and extra properties; return field-specific errors and record schema violations." },
      { name: "Conditional scenarios", text: "Match arguments with JSON Schema and return scenario-specific responses; preview a matcher against sample input in the editor." },
      { name: "Response sequences", text: "Serve ordered responses for matching calls within a run ID, repeating the final response after the sequence ends." },
      { name: "Scheduled transient failures", text: "Inject deterministic 429, 500, 502, or 503 faults at selected steps, with retry guidance and Retry-After behavior." },
      { name: "Assertions and semantic criteria", text: "Check expected ordered tool calls and final-answer phrases; optionally judge answers against successful tool evidence." },
      { name: "Revision history", text: "Compare tool configuration revisions, inspect changed fields, and restore a prior configuration." },
    ],
  },
  {
    icon: Sparkles,
    title: "Agent Playground and Meta AI",
    description: "Exercise tools with a model and use AI assistance for editable drafts, not automatic production changes.",
    features: [
      { name: "Agent Playground", text: "Choose a configured model and active mock tools, run a prompt, and inspect its final answer and tool calls." },
      { name: "Protected-tool support", text: "Provide temporary keys for selected protected tools; credentials are sent to the matching gateway call, not the model prompt or saved run." },
      { name: "Meta AI Tool Studio", text: "Draft an editable tool name, schema, response, and scenarios from a natural-language description." },
      { name: "Workspace assistant", text: "Chat for tool-design and testing ideas; it does not automatically access workspace data." },
      { name: "Model selection", text: "Use the configured Meta-compatible provider and available model catalog; model credentials stay server-side." },
      { name: "Reasoning continuity", text: "Native Meta Responses API Playground runs can replay encrypted reasoning between tool turns with provider-side storage disabled." },
    ],
  },
  {
    icon: Workflow,
    title: "Regression tests, coverage, and run workflows",
    description: "Save checks, run cases, investigate failures, and target unobserved behavior with reviewable drafts.",
    features: [
      { name: "Saved suites and prompt cases", text: "Create suites with up to 20 named cases, selected tools, and expected behavior." },
      { name: "Ordered tool-call checks", text: "Assert the exact tool names and order for a run, including unexpected or missing calls." },
      { name: "Final-answer and response checks", text: "Check phrases and JSON response fields using equality, contains, existence, numeric comparisons, or JSON Schema shape assertions." },
      { name: "Semantic answer checks", text: "Optionally evaluate an answer against successful tool responses and timestamps using the configured model judge." },
      { name: "Suite execution controls", text: "Run one case or all cases with confirmation, see per-check outcomes and traces, and stop after the active case." },
      { name: "Run history, replay, and branches", text: "Replay prompt, model, checks, and current or saved tool configuration; compare with the source run or branch into an edited test." },
      { name: "Coverage-guided drafts", text: "Target arguments, enum values, scenarios, and response steps not observed in the recent saved traces." },
      { name: "Auto-Improve rounds", text: "Measure baseline coverage, review generated cases, and confirm bounded rounds to measure coverage changes." },
      { name: "Failure explanations and follow-ups", text: "Generate evidence-linked explanations and follow-up cases from failed checks and bounded traces." },
      { name: "Contract-risk review", text: "Ask for advisory schema/scenario risks with contract pointers and draft prompts; findings do not modify tools." },
      { name: "Suite portability", text: "Export versioned JSON bundles and import them after validating suites and mapping tool names to active workspace tools." },
    ],
  },
  {
    icon: Play,
    title: "Execution logs, traces, and analytics",
    description: "Inspect mock calls and saved test evidence, then understand trends in the data available to your workspace.",
    features: [
      { name: "Execution logs", text: "Inspect tool arguments and responses, status, latency, validation errors, matched scenario/step, run ID, and transport." },
      { name: "MCP-aware logs", text: "Identify MCP requests by transport, JSON-RPC method, and called tool; logs use workspace retention settings." },
      { name: "Final-answer submissions", text: "Review configured run-level phrase, tool-sequence, and semantic assertion outcomes." },
      { name: "Bounded run traces", text: "Review saved prompt and trace, ordered tool calls, model/provider metadata, and reasoning-replay status without exposing encrypted reasoning." },
      { name: "Mock-call replay comparison", text: "Replay a saved successful request and compare its response with the current mock configuration." },
      { name: "Regression analytics and coverage", text: "Explore pass rates, recent trends, recurring failures, model breakdowns, and coverage observed in available saved traces." },
      { name: "Usage analytics", text: "View daily calls, average latency, schema violations, and injected failures over the available reporting period." },
      { name: "Advanced insights", text: "Inspect service health integrations and workspace-level operational indicators." },
    ],
  },
  {
    icon: Code2,
    title: "SDK, API, and CI integrations",
    description: "Call mocks from agent code and run saved tests from local scripts or GitHub Actions.",
    features: [
      { name: "JavaScript and TypeScript SDK", text: "Use the published trymockagent npm package for tool calls with run IDs and optional bearer-key authentication." },
      { name: "HTTP API", text: "Call the HTTPS gateway from any language; use run IDs to group calls and make sequence behavior repeatable." },
      { name: "Python SDK source", text: "Use the source package in the repository; it is not currently published on PyPI." },
      { name: "CI regression runner", text: "Run selected or all saved suites locally or in a manual GitHub Actions workflow; failures return a nonzero exit code." },
      { name: "Pull request feedback", text: "Optionally update one PR comment with hosted suite results and changed files; the workflow checks out the trusted base revision." },
    ],
  },
  {
    icon: Download,
    title: "MCP, imports, and captured traffic",
    description: "Start from existing tool definitions or turn a reviewed capture into reusable mocks.",
    features: [
      { name: "Hosted MCP toolsets", text: "Connect compatible MCP clients to workspace tools over a stateless HTTP endpoint with API-key or open-token authentication." },
      { name: "Import existing definitions", text: "Preview and create tools from OpenAPI JSON/YAML, OpenAI or Anthropic function definitions, and MCP tool lists." },
      { name: "Offline HAR capture import", text: "Convert exported JSON request/response exchanges into inferred contracts, exact-match scenarios, and response sequences." },
      { name: "Capture limitations", text: "HAR import does not contact upstream hosts or replay status codes and headers. Review captures for sensitive data before importing." },
    ],
  },
  {
    icon: ShieldCheck,
    title: "Access, usage, plans, and retention",
    description: "Scope data to workspaces, protect tool calls, and manage usage within plan entitlements.",
    features: [
      { name: "Workspace isolation and roles", text: "Organize tools, suites, runs, logs, keys, settings, and members with owner, admin, and member roles." },
      { name: "Workspace API keys", text: "Create named bearer keys with monthly limits, reveal a key once, and revoke it when no longer needed." },
      { name: "Tool and toolset access", text: "Protect individual HTTP tools and configure MCP toolsets for workspace-key or open-token access." },
      { name: "Rate limits and quotas", text: "Apply gateway limits and shared monthly workspace call and AI-request quotas." },
      { name: "Plan and billing controls", text: "Review Free (3 tools), Solo (25), and Team (250) entitlements, usage meters, and paid subscriptions where billing is configured." },
      { name: "Workspace-level limits", text: "Plan entitlements include monthly call and AI quotas, seats, API-key counts, and maximum log retention; AI requests also have a shared per-minute limit." },
      { name: "Log retention", text: "Choose a retention period permitted by the plan; scheduled cleanup removes expired execution logs." },
    ],
  },
  {
    icon: Waypoints,
    title: "Hosted MCP and tool imports",
    description: "Connect MCP clients or create mocks from existing contracts and supported traffic captures.",
    features: [
      { name: "Hosted MCP toolsets", text: "Expose selected workspace tools at a stateless HTTP MCP endpoint for compatible agent clients." },
      { name: "Protocol compatibility", text: "Support discovery, tool listing/calling, legacy initialization and ping; no session IDs or deprecated HTTP+SSE." },
      { name: "MCP authentication and execution", text: "Use workspace bearer keys or a one-time open URL token; calls share HTTP validation, scenario, quota, and logging behavior." },
      { name: "Import from OpenAPI", text: "Parse JSON or YAML operations and resolve local references without fetching external references." },
      { name: "Import function tools", text: "Preview OpenAI and Anthropic function definitions, plus MCP tool-list results." },
      { name: "Import HAR 1.2 captures", text: "Convert supported JSON request/response exchanges to inferred schemas, exact-match scenarios, and same-run response sequences." },
      { name: "Import review and safety limits", text: "Preview before saving; external hosts are never contacted, import sizes are bounded, and common credentials are scrubbed. HAR status and headers are not replayed." },
    ],
  },
  {
    icon: ShieldCheck,
    title: "Safe, reproducible demo",
    description: "Explore a realistic agent-tool regression without triggering a real business action.",
    features: [
      { name: "Delayed-order refund walkthrough", text: "Reproduce an agent bug involving a pending order, then inspect an evidence-based review and corrected rerun." },
      { name: "Local deterministic sample", text: "The seeded browser demo uses sample tools and a deterministic sample agent; it does not create workspace records or issue a refund." },
      { name: "Demo AI review", text: "The optional explanation is generated by the configured model and consumes normal workspace AI usage." },
    ],
  },
];

const steps = [
  { number: "1", title: "Describe the tool", text: "Add a name, argument schema, default response, and any conditional scenarios." },
  { number: "2", title: "Point your agent at it", text: "Use the generated HTTPS endpoint as the tool handler in your agent or test harness." },
  { number: "3", title: "Inspect and iterate", text: "Review calls, validation failures, latency, and replay comparisons in one workspace." },
];

const faqs = [
  {
    question: "Can I connect an agent to MockAgent over MCP?",
    answer:
      "Yes. Create a workspace toolset and use its hosted, stateless MCP HTTP endpoint. Authentication can use a workspace API key or an open URL token. MCP calls share the mock execution engine, quotas, and execution logs.",
  },
  {
    question: "What can I import into MockAgent?",
    answer:
      "You can preview and create tools from OpenAPI JSON or YAML, OpenAI or Anthropic function tool definitions, MCP tool lists, and exported HAR 1.2 captures. Imports create local mocks; they do not call pasted MCP servers or captured API hosts.",
  },
  {
    question: "Does HAR import record live traffic or replay the original service?",
    answer:
      "HAR import processes a capture file you provide. It creates mock contracts and scenarios from supported JSON exchanges; it is not a live proxy, and it does not replay captured response status codes or headers. Inspect data for secrets and personal information before import.",
  },
  {
    question: "Can regression suites run in GitHub Actions?",
    answer:
      "Yes. The included Node runner runs saved suites, and the optional pull-request workflow updates a bot comment with hosted-suite results and changed files. Configure a dedicated workspace API key and base URL as GitHub Actions secrets.",
  },
];

export const metadata: Metadata = {
  title: "AI Agent Tool Mocking, MCP & Regression Testing",
  description:
    "Mock AI agent tools, connect via MCP, import OpenAPI or HAR captures, test scenarios, and run regression suites with GitHub Actions.",
  keywords: [
    "AI agent tool mocking",
    "MCP server for AI agents",
    "agent regression testing",
    "OpenAPI mock generator",
    "HAR traffic import",
    "JSON Schema tool validation",
    "GitHub Actions agent tests",
  ],
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    url: "https://mockagent.online/",
    title: "MockAgent | AI Agent Tool Mocking, MCP & Testing",
    description:
      "Build mock tools, connect agents over MCP, import definitions or HAR captures, and run repeatable regression tests.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "MockAgent AI agent tool testing" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MockAgent | AI Agent Tool Mocking, MCP & Testing",
    description:
      "Build mock tools, connect agents over MCP, import definitions or HAR captures, and run repeatable regression tests.",
    images: ["/opengraph-image"],
  },
};

const structuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      name: "MockAgent",
      url: "https://mockagent.online/",
      publisher: { "@id": "https://mockagent.online/#software" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://mockagent.online/#software",
      name: "MockAgent",
      url: "https://mockagent.online/",
      sameAs: ["https://www.linkedin.com/company/145242834/"],
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      description:
        "Create and validate mock tools, connect agent clients over MCP, import tool definitions and HAR captures, run regression suites, and inspect execution evidence.",
      featureList: [
        "HTTP mock endpoints and per-tool API-key protection",
        "JSON Schema validation for mock tool calls",
        "Conditional scenarios, response sequences, scenario previews, and scheduled retryable HTTP failures",
        "Tool configuration revisions, comparison, and restore",
        "Agent Playground with configured model selection and tool-call traces",
        "Meta AI Tool Studio, workspace assistant, regression drafts, failure explanations, and contract-risk reviews",
        "Final-answer assertions, response-field assertions, and optional semantic answer evaluation",
        "Saved multi-case regression suites, run history, replay, branching, and source-run comparisons",
        "Coverage analysis and bounded Auto-Improve rounds",
        "OpenAPI, OpenAI, Anthropic, MCP tool-list, and offline HAR imports",
        "Offline HAR conversion to request schemas, exact-match scenarios, and response sequences",
        "Stateless MCP discovery, tool listing, tool calls, legacy initialize, and ping",
        "JavaScript/TypeScript SDK, HTTP API, and Python SDK source",
        "Local/Actions regression runner and optional pull request result comments",
        "Execution and final-answer logs, bounded traces, replay comparisons, usage analytics, and service insights",
        "Shared workspaces, member roles, API keys, rate limits, plan quotas, billing controls, and log retention",
        "Safe seeded delayed-order demo that does not issue a real refund",
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: faqs.map(({ question, answer }) => ({
        "@type": "Question",
        name: question,
        acceptedAnswer: { "@type": "Answer", text: answer },
      })),
    },
  ],
};

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  return (
    <main className="landing-shell min-h-screen overflow-hidden bg-[#f3f7f3] text-[#142c25]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />
      <header className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8 lg:px-12">
        <Link href="/" className="flex items-center gap-3" aria-label="MockAgent home">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#143d31] text-[#dfff8b]">
            <Waypoints className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="text-lg font-semibold tracking-normal">MockAgent</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3" aria-label="Main navigation">
          <a
            href="#sdk"
            className="rounded-lg px-3 py-2 text-sm font-medium text-[#43584f] transition hover:bg-white/70 hover:text-[#142c25] sm:px-4"
          >
            SDK
          </a>
          <a
            href="#features"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-[#43584f] transition hover:bg-white/70 hover:text-[#142c25] sm:inline-flex"
          >
            Features
          </a>
          <a
            href="#faq"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-[#43584f] transition hover:bg-white/70 hover:text-[#142c25] sm:inline-flex"
          >
            FAQ
          </a>
          <Link
            href="/login?mode=login"
            className="rounded-lg px-3 py-2 text-sm font-medium text-[#43584f] transition hover:bg-white/70 hover:text-[#142c25] sm:px-4"
          >
            Log in
          </Link>
          <Link
            href="/login?mode=signup"
            className="inline-flex items-center gap-2 rounded-lg bg-[#c9f36a] px-3.5 py-2.5 text-sm font-semibold text-[#142c25] transition hover:bg-[#b9e65a] sm:px-4"
          >
            Create account <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </nav>
      </header>

      <section className="landing-enter relative mx-auto max-w-7xl px-5 pb-14 pt-10 sm:px-8 sm:pt-16 lg:px-12 lg:pt-20">
        <div className="landing-grid pointer-events-none absolute inset-x-0 top-0 -z-0 h-[460px] opacity-60" />
        <div className="relative z-[1] max-w-4xl">
          <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-[#cbd8cd] bg-white/70 px-3 py-1.5 text-xs font-semibold uppercase text-[#39705b]">
            <CircleDot className="h-3.5 w-3.5" aria-hidden="true" />
            A test bench for AI agent tools
          </p>
          <h1 className="max-w-4xl font-serif text-5xl font-medium leading-[1.04] text-[#142c25] sm:text-6xl lg:text-7xl">
            MockAgent
            <span className="mt-2 block font-sans text-3xl font-medium leading-tight text-[#39705b] sm:text-4xl lg:text-5xl">
              Test the tool calls your agent hasn&apos;t made yet.
            </span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-7 text-[#51645a] sm:text-lg sm:leading-8">
            Build and import mock tools, connect agent clients over MCP, and test edge cases before production. Run saved regression suites in GitHub Actions and review supported HAR captures as local scenarios—without sending requests to captured hosts.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href="/login?mode=signup"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-[#143d31] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#20533f]"
            >
              Start building <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link
              href="/login?mode=login"
              className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#b9c9bd] bg-white/70 px-5 py-3 text-sm font-semibold text-[#28473a] transition hover:bg-white"
            >
              Log in to your workspace
            </Link>
          </div>
          <div className="mt-6 flex flex-wrap gap-x-5 gap-y-2 text-xs font-medium text-[#607369]">
            <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[#39805d]" /> JSON Schema validation</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[#39805d]" /> No live service calls</span>
            <span className="inline-flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-[#39805d]" /> Inspect every run</span>
          </div>
        </div>

        <div className="relative z-[1] mt-12 lg:mt-16" aria-label="MockAgent dashboard preview">
          <div className="overflow-hidden rounded-2xl border border-[#b8c8bd] bg-white shadow-[0_24px_70px_-38px_rgba(20,44,37,0.45)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e1e9e1] bg-[#fbfcf9] px-4 py-3 sm:px-6">
              <div className="flex items-center gap-3">
                <div className="flex gap-1.5" aria-hidden="true">
                  <span className="h-2.5 w-2.5 rounded-full bg-[#ed896a]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#e7c85c]" />
                  <span className="h-2.5 w-2.5 rounded-full bg-[#8acb88]" />
                </div>
                <span className="text-xs font-medium text-[#6c7c72]">workspace / tools / issue_refund</span>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e8f5e9] px-2.5 py-1 text-[11px] font-semibold text-[#34724f]">
                <span className="h-1.5 w-1.5 rounded-full bg-[#4b9a62]" /> INTERACTIVE DEMO
              </span>
            </div>

            <div className="grid lg:grid-cols-[1fr_0.82fr]">
              <div className="border-b border-[#e1e9e1] p-4 sm:p-6 lg:border-b-0 lg:border-r">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-[#819087]">Execution log</p>
                    <h2 className="mt-1 text-lg font-semibold text-[#19362a]">Recent tool calls</h2>
                  </div>
                  <span className="rounded-md bg-[#f0f4ee] px-2 py-1 font-mono text-[10px] text-[#587064]">SAMPLE</span>
                </div>
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-[#d9eadb] bg-[#f5fbf5] px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#28473a]">issue_refund</p>
                      <p className="mt-1 truncate font-mono text-[11px] text-[#718278]">{`{ "user_id": "vip" }`}</p>
                    </div>
                    <div className="text-right">
                      <span className="rounded-full bg-[#d9f0db] px-2 py-1 text-[10px] font-semibold text-[#36714c]">SUCCESS</span>
                      <p className="mt-1 font-mono text-[10px] text-[#7a8980]">42 ms</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-lg border border-[#f0dfcb] bg-[#fffaf4] px-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[#514031]">issue_refund</p>
                      <p className="mt-1 truncate font-mono text-[11px] text-[#8d7d6d]">{`{ "reason": "missing id" }`}</p>
                    </div>
                    <div className="text-right">
                      <span className="rounded-full bg-[#fae6d4] px-2 py-1 text-[10px] font-semibold text-[#9a592d]">SCHEMA ERROR</span>
                      <p className="mt-1 font-mono text-[10px] text-[#8d7d6d]">58 ms</p>
                    </div>
                  </div>
                </div>
                <div className="mt-5 flex items-center gap-2 border-t border-[#edf0e9] pt-4 text-xs text-[#6b7d72]">
                  <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                  Every request leaves a trace you can inspect and replay.
                </div>
              </div>

              <InteractiveToolDemo />
            </div>
          </div>
          <p className="flex items-center gap-2 px-4 py-3 text-[11px] text-[#6b7d72] sm:px-6">
            <KeyRound className="h-3.5 w-3.5 text-[#39805d]" aria-hidden="true" />
            In your workspace, each test also appears in execution logs. Add bearer-key protection when a mock is ready to share.
          </p>
        </div>
        <a href="#overview" className="mt-8 inline-flex items-center gap-2 text-xs font-semibold uppercase text-[#718278] transition hover:text-[#245b45]">
          Explore the workflow <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
        </a>
      </section>

      <section id="overview" className="border-y border-[#dce5dc] bg-white px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <div>
              <p className="text-xs font-semibold uppercase text-[#4a8064]">Why MockAgent</p>
              <h2 className="mt-3 max-w-xl font-serif text-3xl font-medium leading-tight text-[#17362a] sm:text-4xl">
                Build the integration before the real integration is ready.
              </h2>
            </div>
            <p className="max-w-2xl text-base leading-7 text-[#5a6d62]">
              Agent tool calls are hard to test when the service is unfinished, expensive, rate-limited, or capable of real side effects. MockAgent gives each tool a predictable HTTPS endpoint, so you can iterate on schemas and agent behavior in a controlled workspace.
            </p>
          </div>

          <div className="mt-12 grid gap-x-8 gap-y-10 border-t border-[#e1e9e1] pt-8 sm:grid-cols-2 xl:grid-cols-5">
            {capabilities.map((item) => {
              const Icon = item.icon;
              return (
                <article key={item.number} className="group">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-[#88a092]">{item.number}</span>
                    <Icon className="h-5 w-5 text-[#428064] transition group-hover:text-[#c07849]" aria-hidden="true" />
                  </div>
                  <h3 className="mt-5 text-lg font-semibold text-[#1c3b2e]">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-[#68796f]">{item.text}</p>
                  <p className="mt-4 font-mono text-[10px] font-medium uppercase text-[#8b9d91]">{item.detail}</p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section id="features" className="px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <div className="mx-auto max-w-7xl">
          <div className="max-w-3xl">
            <p className="text-xs font-semibold uppercase text-[#4a8064]">The full toolkit</p>
            <h2 className="mt-3 font-serif text-3xl font-medium leading-tight text-[#17362a] sm:text-4xl">
              Everything to mock, exercise, and improve agent tool behavior.
            </h2>
            <p className="mt-4 text-sm leading-6 text-[#65776c] sm:text-base">
              Explore MockAgent&apos;s testing, Meta AI, observability, integration, and workspace features at a glance. AI-generated content stays reviewable; coverage reflects the saved traces that have actually been run.
            </p>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
            {featureGroups.map((group) => {
              const Icon = group.icon;
              return (
                <article key={group.title} className="rounded-2xl border border-[#dce5dc] bg-white p-6 shadow-[0_12px_35px_-30px_rgba(20,44,37,0.5)]">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#edf5eb] text-[#39805d]">
                      <Icon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-[#1c3b2e]">{group.title}</h3>
                      <p className="mt-1 text-sm leading-5 text-[#68796f]">{group.description}</p>
                    </div>
                  </div>
                  <ul className="mt-5 space-y-4 border-t border-[#e6ede5] pt-5">
                    {group.features.map((feature) => (
                      <li key={feature.name} className="flex gap-2.5">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#39805d]" aria-hidden="true" />
                        <p className="text-sm leading-5 text-[#68796f]">
                          <span className="font-semibold text-[#28473a]">{feature.name}.</span>{" "}
                          {feature.text}
                        </p>
                      </li>
                    ))}
                  </ul>
                </article>
              );
            })}
          </div>
          <p className="mt-6 text-xs leading-5 text-[#718278]">
            Meta features require a configured provider and use workspace AI quotas. Semantic QA is optional and model-based. Paid checkout availability depends on each deployment&apos;s billing configuration.
          </p>
        </div>
      </section>

      <section className="px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-12 lg:grid-cols-[0.7fr_1.3fr]">
          <div>
            <p className="text-xs font-semibold uppercase text-[#4a8064]">A simple loop</p>
            <h2 className="mt-3 font-serif text-3xl font-medium leading-tight text-[#17362a] sm:text-4xl">
              From tool definition to repeatable test.
            </h2>
            <p className="mt-4 text-sm leading-6 text-[#65776c]">
              Keep the mock endpoint alongside your agent while the real service evolves. Swap the mock for the production tool when you are ready.
            </p>
            <Link href="/login?mode=signup" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-[#286449] hover:text-[#17362a]">
              Create your first workspace <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
          <div className="divide-y divide-[#d9e3d9] border-y border-[#d9e3d9]">
            {steps.map((step) => (
              <article key={step.number} className="grid gap-3 py-5 sm:grid-cols-[48px_1fr] sm:gap-5">
                <span className="font-mono text-sm text-[#6f987d]">0{step.number}</span>
                <div>
                  <h3 className="text-base font-semibold text-[#203d30]">{step.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[#68796f]">{step.text}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="sdk" className="border-y border-[#dce5dc] bg-white px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase text-[#4a8064]">
              <Code2 className="h-4 w-4" aria-hidden="true" />
              Integrate with the SDK
            </p>
            <h2 className="mt-3 max-w-xl font-serif text-3xl font-medium leading-tight text-[#17362a] sm:text-4xl">
              Call your mocks from your code.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-[#65776c]">
              Install the published <code className="rounded bg-[#eef4ed] px-1.5 py-0.5 font-mono text-[#28473a]">trymockagent</code> npm package and call your mock endpoints directly from JavaScript or TypeScript. Pass run IDs, add bearer keys for protected tools, and inspect structured errors when a call needs fixing.
            </p>
            <a
              href="https://www.npmjs.com/package/trymockagent"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#143d31] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#20533f]"
            >
              View trymockagent on npm <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
            </a>
            <p className="mt-4 text-xs leading-5 text-[#718278]">
              Python client source is available in the project but has not been published to PyPI yet. Any language can call the HTTP endpoint directly.
            </p>
          </div>
          <div className="overflow-hidden rounded-2xl border border-[#d5e0d5] bg-[#172b25] shadow-[0_18px_50px_-35px_rgba(20,44,37,0.5)]">
            <div className="flex items-center justify-between border-b border-[#334b40] px-4 py-3">
              <span className="font-mono text-xs text-[#b2c8b8]">JavaScript / TypeScript</span>
              <span className="rounded-md border border-[#496459] px-2 py-1 font-mono text-[10px] text-[#d9ef83]">trymockagent</span>
            </div>
            <pre className="overflow-x-auto p-5 font-mono text-xs leading-6 text-[#dbe7d9]"><code><span className="text-[#90ab9b]"># Install</span>{"\n"}npm install trymockagent{"\n\n"}<span className="text-[#90ab9b]"># Use the tool in your app</span>{"\n"}{`import { MockAgent } from "trymockagent";\n\nconst mock = new MockAgent({\n  toolId: "YOUR_TOOL_ID",\n});\n\nconst result = await mock.call(\n  { user_id: "vip", reason: "duplicate" },\n  { runId: "test-run-1" },\n);`}</code></pre>
          </div>
        </div>
      </section>

      <section id="faq" className="px-5 py-16 sm:px-8 lg:px-12 lg:py-20">
        <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.7fr_1.3fr]">
          <div>
            <p className="text-xs font-semibold uppercase text-[#4a8064]">Frequently asked questions</p>
            <h2 className="mt-3 font-serif text-3xl font-medium leading-tight text-[#17362a] sm:text-4xl">
              Build a repeatable tool-testing workflow.
            </h2>
            <p className="mt-4 text-sm leading-6 text-[#65776c]">
              Connect your agent, bring an existing contract or capture, then validate behavior with saved tests.
            </p>
          </div>
          <div className="divide-y divide-[#d9e3d9] border-y border-[#d9e3d9]">
            {faqs.map((faq) => (
              <details key={faq.question} className="group py-5">
                <summary className="cursor-pointer list-none pr-6 text-base font-semibold text-[#203d30] marker:hidden">
                  {faq.question}
                </summary>
                <p className="mt-3 max-w-3xl text-sm leading-6 text-[#68796f]">{faq.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-[#17382c] px-5 py-14 text-white sm:px-8 lg:px-12 lg:py-16">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-8 md:flex-row md:items-center">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase text-[#c9f36a]">Start with one tool</p>
            <h2 className="mt-3 font-serif text-3xl font-medium leading-tight sm:text-4xl">Make the next agent run observable.</h2>
            <p className="mt-3 text-sm leading-6 text-[#c5d3c8]">Create a workspace, define a mock contract, and see exactly what your agent sends back.</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Link href="/login?mode=signup" className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[#c9f36a] px-5 py-3 text-sm font-semibold text-[#17382c] transition hover:bg-[#b9e65a]">
              Sign up free <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <Link href="/login?mode=login" className="inline-flex min-h-11 items-center rounded-lg border border-[#628071] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
              Log in
            </Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-6 text-xs text-[#74847a] sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-12">
        <Link href="/" className="font-semibold text-[#28473a]">MockAgent</Link>
        <p>Mock endpoints for the tools your agents call.</p>
        <div className="flex gap-4">
          <a
            href="https://www.linkedin.com/company/145242834/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-[#28473a]"
          >
            LinkedIn
          </a>
          <Link href="/login?mode=login" className="hover:text-[#28473a]">Log in</Link>
          <Link href="/login?mode=signup" className="hover:text-[#28473a]">Sign up</Link>
        </div>
      </footer>
    </main>
  );
}
