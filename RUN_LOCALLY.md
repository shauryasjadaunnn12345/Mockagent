# Run MockAgent locally

This guide starts the MockAgent web app on your machine. It is intended for
developers exploring the code or preparing a change; it does not create a
production deployment.

The hosted production website is [mockagent.online](https://mockagent.online).
Use that link to access the live product. The steps in this guide are only for
running your own local development instance.

## Prerequisites

- Node.js 20 or later and npm.
- A Supabase project for sign-in and database-backed dashboard features.
- A configured Meta-compatible model provider for Playground and AI features.
- Upstash Redis for shared production-style gateway rate limits. Local-only
  workflows may work without it, but should not be treated as production
  verification.

## 1. Install dependencies

From the repository root:

```bash
npm ci
```

For PowerShell, use the same commands in a terminal where npm scripts are
allowed. If PowerShell blocks `npm.ps1`, run the Windows command shim, such as
`npm.cmd ci`.

## 2. Configure the environment

Copy `.env.example` to `.env.local` and fill in the values needed for your
local workflows. The [configuration reference](./docs/CONFIGURATION.md)
describes each variable and which features need it.

At minimum, configure Supabase URL, anon key, service-role key, and
`NEXT_PUBLIC_APP_URL=http://localhost:3000` for a usable authenticated
dashboard. Configure either `MODEL_API_KEY` for the first-party Meta Model API
or the documented Baseten-compatible provider variables for Meta-powered
features. Keep server secrets out of client-prefixed environment variables and
never commit `.env.local`.

## 3. Prepare the database

Apply [`schema.sql`](./schema.sql) to the Supabase project before using the
dashboard. It defines the application tables, access policies, database
functions, and indexes. Re-apply the additive schema when upgrading an existing
development database so it has the latest fields, including saved regression
run configuration snapshots.

Use a dedicated non-production Supabase project while developing. The build
and local test suite do not apply schema changes or prove a live database
migration.

## 4. Start the development server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Stop the server with
`Ctrl+C`.

## 5. Verify a change

Run the relevant checks from the repository root:

```bash
npm test
npm run lint
npm run build
```

`npm run check:config` checks deployment configuration formats and required
settings. It is expected to fail if payment configuration is incomplete. A
successful build or configuration check does not exercise live Supabase,
Meta-provider, Redis, or Dodo Payments behavior.

## Troubleshooting

- **Dashboard cannot load or sign in:** check the Supabase URL, public anon
  key, service-role key, and that the current `schema.sql` has been applied.
- **AI features are unavailable:** confirm one supported model-provider
  configuration is set and its key is valid.
- **Gateway rate limiting is unavailable:** check the Upstash REST URL and
  token, or use a local-only workflow while recognizing that this does not
  verify production rate limits.
- **Port 3000 is occupied:** stop the process using it or configure a different
  local port; update `NEXT_PUBLIC_APP_URL` to match.
- **PowerShell rejects npm commands:** run the `.cmd` shim, for example
  `npm.cmd run lint`.

For system design and request flow, see the
[architecture guide](./docs/ARCHITECTURE.md). For the product walkthrough,
see [`walkthrough.md`](./walkthrough.md).
