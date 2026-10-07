import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CircleDot,
  Clock3,
  KeyRound,
  Play,
  ShieldCheck,
  Waypoints,
  Workflow,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";

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
    text: "Match inputs to named scenarios and return different responses. Try edge cases without wiring up real services or test accounts.",
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
];

const steps = [
  { number: "1", title: "Describe the tool", text: "Add a name, argument schema, default response, and any conditional scenarios." },
  { number: "2", title: "Point your agent at it", text: "Use the generated HTTPS endpoint as the tool handler in your agent or test harness." },
  { number: "3", title: "Inspect and iterate", text: "Review calls, validation failures, latency, and replay comparisons in one workspace." },
];

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "MockAgent",
  url: "https://mockagent.online/",
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
  description:
    "Mock AI agent tools, validate tool-call JSON with JSON Schema, test edge cases, and inspect execution logs before connecting real services.",
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
        <nav className="flex items-center gap-2 sm:gap-3" aria-label="Account">
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
            Build realistic mock endpoints for the tools your AI agent depends on. Validate inputs, exercise edge cases, and replay calls before connecting to production services.
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
                <span className="h-1.5 w-1.5 rounded-full bg-[#4b9a62]" /> GATEWAY ONLINE
              </span>
            </div>

            <div className="grid lg:grid-cols-[1fr_0.82fr]">
              <div className="border-b border-[#e1e9e1] p-4 sm:p-6 lg:border-b-0 lg:border-r">
                <div className="mb-5 flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold uppercase text-[#819087]">Execution log</p>
                    <h2 className="mt-1 text-lg font-semibold text-[#19362a]">Recent tool calls</h2>
                  </div>
                  <span className="rounded-md bg-[#f0f4ee] px-2 py-1 font-mono text-[10px] text-[#587064]">LIVE</span>
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

              <div className="bg-[#172b25] p-4 text-[#dbe7d9] sm:p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase text-[#91a79b]">Scenario response</p>
                    <h3 className="mt-1 text-sm font-semibold text-white">VIP user</h3>
                  </div>
                  <span className="rounded-md border border-[#496459] px-2 py-1 font-mono text-[10px] text-[#b2c8b8]">MATCHED</span>
                </div>
                <pre className="mt-5 overflow-x-auto rounded-lg border border-[#334b40] bg-[#10221c] p-4 font-mono text-xs leading-6 text-[#d8e7d2]"><code><span className="text-[#9bc7a6]">POST</span> /api/v1/mock/tool_id<br /><br /><span className="text-[#90ab9b]">input</span><br />{`{\n  "user_id": "vip",\n  "reason": "duplicate"\n}`}<br /><br /><span className="text-[#90ab9b]">mock response</span><br /><span className="text-[#d9ef83]">{`{ "success": true,\n  "message": "VIP refund processed." }`}</span></code></pre>
                <div className="mt-4 flex items-center gap-2 text-[11px] text-[#a9c0b0]">
                  <KeyRound className="h-3.5 w-3.5 text-[#d9ef83]" aria-hidden="true" />
                  Add bearer-key protection when a mock is ready to share.
                </div>
              </div>
            </div>
          </div>
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

          <div className="mt-12 grid gap-x-8 gap-y-10 border-t border-[#e1e9e1] pt-8 sm:grid-cols-2 xl:grid-cols-4">
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
          <Link href="/login?mode=login" className="hover:text-[#28473a]">Log in</Link>
          <Link href="/login?mode=signup" className="hover:text-[#28473a]">Sign up</Link>
        </div>
      </footer>
    </main>
  );
}
