# Render Production Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run the current MAX Mini App and bot on a Node service that trusts MAX's official API certificate and stores application state in Render Free PostgreSQL for a demo deployment.

**Architecture:** Replace the Cloudflare-only runtime with a Node HTTP host that serves the Vite build and forwards API requests to the existing request handler. Implement its KV contract on Render PostgreSQL, use only `platform-api2.max.ru`, and configure the official MAX CA. Both the web service and database use Render Free; the user accepts cold starts and the database's 30-day expiry for this demo.

**Tech Stack:** Node 24, TypeScript, npm workspaces, `pg`, Vite, Render Blueprint, GitHub Actions.

**Spec:** `CONTEXT.md`, `docs/adr/0004-cloudflare-max-api-tls-fallback.md`, Render Free deployment decision in conversation.

## Global Constraints

- Node version is at least 24; use npm workspaces.
- `initData` validation remains server-side.
- Secrets remain outside Git and never enter Vite client variables.
- Node TypeScript uses erasable syntax and explicit `.ts` relative imports.
- Do not route the bot token to `platform-api.max.ru` or disable TLS verification.
- Free Render web services sleep when idle; describe this as a demo limitation.
- Render Free PostgreSQL expires after 30 days; this data-loss behavior is accepted for the demo and must be documented.

## Review Focus

- Missing or malformed `DATABASE_URL` must fail startup clearly before serving traffic.
- PostgreSQL list pagination must not omit or duplicate keys across pages.
- Request bodies and responses must preserve methods, status, headers, and JSON payloads through the Node adapter.
- Static path handling must not permit traversal outside the built Mini App directory.
- Missing MAX CA, bot token, webhook secret, or DaData key must produce actionable behavior without exposing secret values.

---

### Task 1: PostgreSQL implementation of the bot's key-value store

**Files:**
- Create: `apps/bot/src/postgres-store.ts`
- Create: `apps/bot/src/postgres-store.test.ts`
- Modify: `apps/bot/package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: existing `HouseChatStore` contract in `apps/bot/src/index.ts`.
- Produces: `createPostgresHouseChatStore(connectionString)` returning a store with `get`, `put`, `delete`, `list`, and `close`.

- [x] Write tests for persisted values, metadata, deletion, prefix filtering, and cursor pagination; run and observe expected failure.
- [x] Add the PostgreSQL driver and implement schema initialization plus parameterized queries and stable pagination.
- [x] Run the full suite and typecheck.

### Task 2: Node HTTP host for the existing MAX handler and Mini App

**Files:**
- Create: `apps/bot/src/server.ts`
- Create: `apps/bot/src/server.test.ts`
- Modify: `apps/bot/src/index.ts`
- Modify: `apps/bot/package.json`
- Modify: `apps/bot/tsconfig.json`

**Interfaces:**
- Consumes: `createPostgresHouseChatStore` from Task 1 and `handleRequest(request, env)` from `apps/bot/src/index.ts`.
- Produces: a Node server that listens on `process.env.PORT`, routes `/api/*` through `handleRequest`, serves the Mini App build, and returns SPA fallback for client routes.

- [x] Write tests for API forwarding, health checks, static assets, SPA fallback, and path traversal; run and observe expected failure.
- [x] Implement the Node adapter and startup validation for required configuration.
- [x] Run tests and verify the Mini App production build.

### Task 3: Native TLS trust for the official MAX API

**Files:**
- Modify: `apps/bot/src/index.ts`
- Create or update: `docs/adr/0008-render-runtime-and-max-ca.md`
- Modify: `.env.example`

**Interfaces:**
- Consumes: official MAX root certificate source and Node TLS configuration from current official documentation.
- Produces: requests to `platform-api2.max.ru` only, with TLS trust configured at process startup.

- [x] Add a regression test proving HTTP 526 does not trigger a request to the legacy host; run and observe expected failure.
- [x] Remove the legacy-host fallback and document CA provisioning without committing credentials.
- [x] Run the complete test suite.

### Task 4: Render and CI release configuration

**Files:**
- Create: `render.yaml`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: the Node host from Task 2, PostgreSQL URL and CA configuration from Tasks 1 and 3.
- Produces: a Render Blueprint with Node 24 build/start/health settings, secret references, and deploy-after-passing-CI behavior.

- [x] Add a CI workflow that installs lockfile dependencies, runs typecheck and tests, and builds the Mini App.
- [x] Add a Render Blueprint with its free PostgreSQL database and health check `/api/health`; document the 30-day data expiry.
- [x] Run the full test suite, typecheck, Mini App build, and YAML syntax validation of the Render configuration.

### Task 5: Release readiness

**Files:**
- Modify: `README.md`
- Create: `docs/deploy/render.md`

- [x] Document required Render variables and MAX webhook registration steps without including values.
- [ ] Verify the service health response and MAX API certificate from the deployed service before calling the release complete.
- [ ] Publish the demo after CI is green and the user has entered required Render secrets. The user accepts the Free PostgreSQL database expiry after 30 days and possible loss of demo data.
