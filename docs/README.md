# MockAgent documentation

Use this page as the documentation map. Start with the guide that matches what
you want to do; you do not need to read every document to use MockAgent.

**Try the production website:** [mockagent.online](https://mockagent.online).
The guides below also explain how to run or self-host a separate instance.

## Get started

- [Feature guide](./FEATURES.md): concise catalog of MockAgent capabilities,
  workflow, integrations, and important boundaries.
- [Product README](../README.md): project overview, feature summary, dashboard
  guide, API/SDK notes, usage, and self-hosting.
- [Run locally](../RUN_LOCALLY.md): prerequisites, environment setup, database
  initialization, development server, and local validation.
- [Product walkthrough](../walkthrough.md): guided product tour, demo script,
  gateway behavior, data model, and technical limits.

## Understand and integrate

- [Architecture](./ARCHITECTURE.md): components, request paths, persistence
  boundaries, and core workflows.
- [Hosted MCP servers](./MCP.md): toolset setup, authentication, client
  configuration, protocol behavior, and smoke tests.
- [Importing mock tools](./IMPORTING_TOOLS.md): paste OpenAPI, function-tool, or
  MCP tool-list definitions and preview the generated mocks.
- [Configuration](./CONFIGURATION.md): environment variables, secrets,
  provider selection, and operational caveats.
- [Self-hosting](./SELF_HOSTING.md): deploy your own Next.js instance and
  optionally export privacy-bounded OpenTelemetry data.
- [Delayed-order refund example](../examples/delayed-order-refund/README.md):
  reproduce a real-agent tool bug using the JavaScript SDK.
- [CI runner](../scripts/mockagent-ci.mjs): run saved regression suites from
  an automated job; the README explains manual setup and the PR feedback
  workflow.

## Contribute

- [Contributing guide](../CONTRIBUTING.md): development workflow, tests, and
  pull-request expectations.
- [Report a bug](https://github.com/shauryasjadaunnn12345/Mockagent/issues/new?template=bug_report.yml)
  or [request a feature](https://github.com/shauryasjadaunnn12345/Mockagent/issues/new?template=feature_request.yml).
- [Browse existing issues](https://github.com/shauryasjadaunnn12345/Mockagent/issues)
  and [pull requests](https://github.com/shauryasjadaunnn12345/Mockagent/pulls)
  before opening a duplicate.

## Important limitations

- The Python SDK is source-only and is not published on PyPI.
- Paid checkout and subscription management depend on each deployment's Dodo
  Payments configuration.
- AI output and semantic evaluation are fallible; review generated drafts and
  evidence.
- Local tests and builds do not prove live database migrations, authenticated
  workflows, provider connectivity, or payment behavior.
