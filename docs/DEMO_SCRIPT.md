# MockAgent: five-minute recorded demo

This script is designed for a five-minute screen recording of the hosted
product at [mockagent.online](https://mockagent.online). It follows the
delayed-order refund story to show the problem, the failing agent behavior,
Meta's role, a human-reviewed regression draft, and measured coverage.

## What to prepare

- Sign in to the production website before recording. Use a demo workspace
  with no real customer data.
- Open **Regression Tests** in the dashboard and locate the
  **60-second Meta coverage demo** section.
- Confirm Meta AI is configured and the workspace has at least one AI request
  available. The explanation and draft use one AI request.
- Make sure the browser zoom and window size keep the demo section readable.
  Close unrelated tabs and notifications.
- The demo's three tools and agent are deterministic browser-side fixtures.
  There is no need to create real refund tools, add workspace records, or enter
  API keys.
- Run the demo once before recording to check the provider connection, then
  reload the page to reset the visible flow. Have a screenshot or clean
  recording of the completed result available as a fallback if the provider is
  unavailable during capture.

## Timed script

### 0:00–0:35 — Introduce the problem

**On screen:** Open the MockAgent dashboard. Start on Regression Tests, with
the demo panel visible.

**Say:**

> An agent can fail even when its final answer sounds reasonable. It may call a
> tool too early, skip a verification step, or misunderstand a changing
> response. MockAgent gives us a controlled way to test those tool interactions
> before they reach a real service. I’ll show one delayed-order refund bug,
> how Meta helps diagnose it, and how the corrected behavior becomes a
> regression check.

### 0:35–1:05 — Explain the fixture

**On screen:** Point to `lookup_order`, `issue_refund`, and `check_inventory`,
then the delayed-order sequence and flawed prompt.

**Say:**

> This sandbox has three sample tools: look up an order, check inventory, and
> issue a simulated refund. The important edge case is that the order lookup
> returns pending first, then ready on the next lookup. The sample agent prompt
> is intentionally flawed: it says to refund immediately without checking
> status. These fixtures are local to the demo; no real refund or inventory
> operation is possible here.

### 1:05–1:45 — Run the flawed agent

**On screen:** Click **Run demo**. While Meta is reviewing, point to the
flawed run and its tool-call cards. Do not click again while the button says
**Meta is reviewing…**.

**Say:**

> The first run shows the bug as observable tool behavior, not just a vague
> answer-quality concern. The lookup says pending, but the flawed agent still
> attempts the refund. The configured check fails because a refund must not be
> attempted while the order is pending. In a real workspace, this sort of
> evidence also helps connect a failure to the exact arguments and tool
> responses that caused it.

### 1:45–2:35 — Show Meta's explanation and draft

**On screen:** When the explanation appears, point out its cited failed check,
the displayed model if present, and the generated regression case. Read the
prompt briefly and make a small edit only if it improves clarity.

**Say:**

> Meta receives the fixed demo evidence and explains the failed check, then
> drafts a follow-up regression case. The model is assisting with diagnosis
> and test design; it is not changing the agent or saving a test behind our
> backs. I can inspect and edit this draft before accepting it. That review
> step matters: AI output is a proposal, not proof of a root cause.

### 2:35–3:20 — Confirm the regression and corrected rerun

**On screen:** Click **Add reviewed regression test & rerun**. Point to the
corrected run when it completes.

**Say:**

> Now I’ll explicitly accept the reviewed case and run the corrected sample.
> It checks the order again, sees that it is ready, verifies inventory, and
> only then attempts the simulated refund. The check now passes. This shows
> the core loop: expose a failure, turn its evidence into a reviewed test, and
> verify the corrected behavior with a rerun.

### 3:20–4:10 — Explain coverage improvement

**On screen:** Point to the **Coverage improvement** panel and the before,
after, and delta. Let the displayed percentages speak for themselves; do not
promise a particular value.

**Say:**

> Coverage here is measured from the configured mock tools and the demo's
> recorded tool traces. The panel compares what the flawed run exercised with
> what the corrected run adds, including observed arguments, scenarios, and
> response-sequence steps. The number is a measured result for these fixtures,
> not a claim that every possible behavior is covered or that the agent is
> universally correct.

### 4:10–4:40 — Connect to the rest of the product

**On screen:** Briefly point to the regression tests and coverage features,
then navigate to the tool or Playground area only if it is already loaded and
safe to show.

**Say:**

> The same idea extends beyond this sandbox. Teams can define mock endpoints
> with JSON Schema, create conditional scenarios and response sequences,
> inspect execution logs, and save repeatable regression cases. The
> Playground runs a configured model against selected mock tools. Saved runs
> can be compared or replayed, including with saved tool configuration when a
> snapshot exists.

### 4:40–5:00 — Close

**On screen:** Return to the completed demo result or leave the coverage panel
visible. End on the MockAgent name or website.

**Say:**

> MockAgent makes agent-tool behavior repeatable and inspectable before an
> agent is connected to production services. Meta helps us find and draft
> tests for the gaps, while the developer reviews the changes and confirms
> what gets saved and run. Visit mockagent.online to explore the product.

## Recording notes

- The Meta explanation can take longer than the scripted segment. Pause
  narration while it runs, then trim dead time in editing; do not imply the
  output is instant.
- If the Meta provider is unavailable, do not claim Meta completed the
  explanation. Show the pre-recorded result as an edited walkthrough and label
  it accordingly, or record the non-AI product tour instead.
- Keep any account email, workspace identifiers, API keys, and private
  customer data out of frame.
- The demo uses one AI request and counts against the current workspace quota.
- The demo rerun is a deterministic browser-side sample flow. It does not
  create a saved workspace regression run. To show real persisted tests,
  traces, logs, or replay, prepare a separate demo workspace and clearly
  distinguish that workflow from the sandbox.
