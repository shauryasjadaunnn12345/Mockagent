# Contributing to MockAgent

Thanks for helping improve MockAgent. Contributions that make agent tool
behavior easier to test, understand, and reproduce are welcome.

## Before you start

1. Read the [project README](./README.md) and [documentation index](./docs/README.md).
2. Search [existing issues](https://github.com/shauryasjadaunnn12345/Mockagent/issues)
   and pull requests before opening a duplicate.
3. For a substantial behavior or API change, open an issue first to agree on
   the intended behavior. Small fixes and documentation improvements can go
   directly to a pull request.

## Local development

Follow [Run MockAgent locally](./RUN_LOCALLY.md) to prepare your environment.
Use a development Supabase project, not production data. You do not need to
commit credentials or copy real customer payloads into tests.

Before submitting a code change, run:

```bash
npm test
npm run lint
npm run build
```

The `npm test` command runs the repository's Node.js test suite, including
offline SDK/example tests. The build and tests do not verify live database
migrations, authentication, payment checkout, or provider credentials. Note
any such limitation in the pull request.

## Making a change

- Keep changes focused and follow existing names, patterns, and formatting.
- Preserve existing API behavior unless the issue explicitly calls for a
  change. Document compatibility and migration requirements for database or
  public API changes.
- Add or update tests for behavior changes. Prefer focused, deterministic
  tests that do not need live credentials.
- Update the relevant README or guide when user-visible behavior,
  configuration, setup, or limitations change.
- Keep generated AI output reviewable; do not silently persist generated
  content.
- Never commit secrets, user data, build output, or local environment files.

## Pull requests

Use the pull-request template. Include:

- The problem and the intended change.
- How a reviewer can reproduce or verify the behavior.
- The commands you ran and their results.
- Any database migration, configuration, security, or API compatibility
  notes.
- Screenshots or a short recording for user-facing UI changes, when useful.

Keep pull requests small enough to review. A maintainer may ask for changes or
additional tests before merging.

## Reporting issues

Use the repository's [bug report](https://github.com/shauryasjadaunnn12345/Mockagent/issues/new?template=bug_report.yml)
or [feature request](https://github.com/shauryasjadaunnn12345/Mockagent/issues/new?template=feature_request.yml)
form. Include a minimal reproduction and redact secrets, API keys, personal
data, and private endpoint details from logs.
