# MaxTown Render Free Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy MaxTown as one Render Free Fastify service backed by Render Free PostgreSQL, with CI-gated deployment, protected Moderator access, and reproducible local/hosted smoke checks.

**Architecture:** Keep the existing Fastify API and expose the built Mini App and Moderator panel from the same process. Fastify enforces Basic Authentication and checks the authenticated principal against enabled database Moderators; startup applies migrations and inserts the configured initial Moderator without re-enabling a disabled account. GitHub Actions validates and builds the Render Blueprint image, and Render deploys only after GitHub checks pass.

**Tech Stack:** Node 24, npm workspaces, TypeScript, Fastify 5, `@fastify/static`, `bcryptjs`, PostgreSQL 16, Docker, GitHub Actions, Render Blueprint, Vitest.

**Spec:** [docs/superpowers/specs/2026-09-maxtown-render-free-design.md](../specs/2026-09-maxtown-render-free-design.md)

## Global Constraints

- Node.js `>=24`; npm workspaces remain the package manager.
- Keep MAX `initData` verification in `apps/api`; never trust `initDataUnsafe` for authenticity.
- Keep Mini App and Moderator panel same-origin with the API; do not add CORS.
- Moderator credentials are `MODERATOR_USERNAME` plus bcrypt-compatible `MODERATOR_PASSWORD_HASH`; plaintext passwords and tokens never enter Git.
- The authenticated Moderator identity comes from server-verified Basic credentials; caller-supplied `X-MaxTown-Moderator` never grants access.
- Render uses one `free` Docker web service, one `free` PostgreSQL database, `PORT`, `/api/ready`, and `autoDeployTrigger: checksPass`.
- Free Render PostgreSQL is a demo database: 1 GB, expires 30 days after creation, and is deleted after the 14-day upgrade grace period.
- Free web services can sleep after 15 minutes idle, take about a minute to wake, and share 750 free service hours per workspace per month.
- Migrations must finish before the web process listens; a failed migration or missing required production secret must fail startup.
- No VPS SSH deployment, production GHCR publishing workflow, or durable-data/backup claim remains in the release path.

## Review Focus

- Malformed, oversized, or invalid Basic credentials and spoofed identity headers must fail closed with `401` and `WWW-Authenticate`; Task 1 tests parser and route behavior.
- A valid Basic principal that is absent or disabled in `moderators` must not access data; Task 2 tests enabled, unknown, disabled, and idempotent bootstrap cases.
- Missing static assets, `/admin` path boundaries, dotfiles, and unknown `/api/*` routes must not leak files or return the wrong SPA; Task 3 tests these paths using fixture asset roots.
- Missing `PORT`/credentials, database outage, or migration failure must not produce a listening/ready service; Task 4 tests startup failure and signal-safe shutdown.
- Empty and already-migrated databases, failed Compose smoke, and invalid Render configuration must be caught before deployment; Tasks 6–8 exercise migrations, clean-stack smoke, Blueprint validation, and CI gating.

---

## File Map

- `apps/api/src/auth/moderator-basic-auth.ts`: parse and verify Basic credentials, install the shared Moderator path gate, decorate requests with the verified principal.
- `apps/api/src/auth/moderator-basic-auth.test.ts`: credential parsing, challenge response, path matching, and spoof resistance.
- `apps/api/src/types/fastify.d.ts`: Fastify request augmentation for `moderatorPrincipal`.
- `apps/api/src/routes/moderator.ts`: authorize using the Fastify-verified principal and the existing enabled-Moderator lookup.
- `apps/api/src/routes/moderator.test.ts`: update protected-route tests to exercise Basic Authentication.
- `apps/api/src/db/moderators.ts`: insert the configured bootstrap principal idempotently.
- `apps/api/src/db/moderators.test.ts`: bootstrap and disabled-account preservation tests.
- `apps/api/src/app.ts`: register authentication, API routes, static roots, and explicit Mini App/Admin SPA fallbacks.
- `apps/api/src/app.test.ts`: static routing and unknown-path behavior with temporary fixture roots.
- `apps/api/src/bootstrap.ts`: validate production configuration, migrate and bootstrap before listening, honor `PORT`, and close cleanly.
- `apps/api/src/bootstrap.test.ts`: startup order and fail-closed configuration tests.
- `apps/api/Dockerfile`: build both Vite apps and create one minimal runtime image containing API and static distributions.
- `compose.yml`, `deploy/compose.smoke.yml`, `deploy/compose-smoke.sh`, `deploy/smoke.sh`: one-service-plus-Postgres local smoke topology and HTTP/auth checks.
- `render.yaml`: Render Free web/database Blueprint, secret prompts, health check, and checks-pass deploy trigger.
- `.github/workflows/ci.yml`: test/build the combined image, validate Blueprint, and run clean Compose smoke.
- `.github/workflows/deploy.yml`: remove obsolete VPS/GHCR publishing workflow.
- `Caddyfile`, `deploy/Caddyfile.smoke`, `deploy/deploy.sh`, obsolete VPS-only deployment tests: remove the retired VPS release path.
- `.env.example`, `README.md`, `docs/deployment.md`: document local values, Render setup, free-tier limits, secrets, and hosted smoke.

## Task 1: Fastify Moderator Basic Authentication

**Files:**
- Create: `apps/api/src/auth/moderator-basic-auth.ts`
- Create: `apps/api/src/auth/moderator-basic-auth.test.ts`
- Create: `apps/api/src/types/fastify.d.ts`
- Modify: `apps/api/package.json`, `package-lock.json`, `apps/api/src/app.ts`

**Interfaces:**
- Produces `registerModeratorBasicAuth(app: FastifyInstance, env: NodeJS.ProcessEnv): void`.
- Produces `FastifyRequest.moderatorPrincipal: string | null`; it is set only after bcrypt verification and only for protected Moderator paths.
- Protected paths are `/admin`, `/admin/…`, and `/api/moderator/…`; all other paths continue without Basic Authentication.
- Required configuration is `MODERATOR_USERNAME` and a valid bcrypt hash in `MODERATOR_PASSWORD_HASH`. In production, missing/invalid configuration throws during app construction; development/test callers may inject explicit test values.
- A missing, malformed, wrong, or invalid credential returns `401` with `WWW-Authenticate: Basic realm="MaxTown Moderator", charset="UTF-8"`; never log the `Authorization` header.

- [ ] **Step 1: Add focused failing tests** for valid credentials; absent credentials; invalid base64; missing colon; wrong username/password; oversized header; encoded username/password; protected route matching; and a spoofed `X-MaxTown-Moderator` header.
- [ ] **Step 2: Run the new test file** with `npm test -- --run apps/api/src/auth/moderator-basic-auth.test.ts`; confirm the expected missing-module or failed assertions.
- [ ] **Step 3: Add `bcryptjs` as an API runtime dependency** and implement credential parsing plus async bcrypt verification in `moderator-basic-auth.ts`. Reject credential payloads over 4 KiB before decoding. Use a request hook and typed request decorator; do not copy identity from a request header.
- [ ] **Step 4: Register the auth hook in `buildApp`** and make the focused tests assert protected requests receive the challenge while `/`, `/api/health`, and resident APIs remain unaffected.
- [ ] **Step 5: Run focused tests and API typecheck** with `npm test -- --run apps/api/src/auth/moderator-basic-auth.test.ts` and `npm run typecheck --workspace=@maxtown/api`; both pass.
- [ ] **Step 6: Commit** as `feat(api): add moderator basic authentication`.

## Task 2: Bind the Authenticated Principal to Enabled Moderators

**Files:**
- Create: `apps/api/src/db/moderators.ts`
- Create: `apps/api/src/db/moderators.test.ts`
- Modify: `apps/api/src/routes/moderator.ts`, `apps/api/src/routes/moderator.test.ts`

**Interfaces:**
- Consumes `request.moderatorPrincipal` from Task 1.
- Produces `ensureBootstrapModerator(pool: Pool, principal: string): Promise<void>` which runs `INSERT INTO moderators (principal) VALUES ($1) ON CONFLICT (principal) DO NOTHING`.
- Moderator route authorization checks `request.moderatorPrincipal`, then verifies `principal = $1 AND disabled_at IS NULL` in the existing table. The value recorded as `decided_by_principal` is this verified principal.

- [ ] **Step 1: Update route integration tests** so requests use valid Basic credentials, and add checks that Basic auth for an unknown principal and a disabled principal returns `401`; a spoofed identity header with no Basic credentials also returns `401`.
- [ ] **Step 2: Run** `npm test -- --run apps/api/src/routes/moderator.test.ts`; confirm new Basic-auth path tests fail before route changes.
- [ ] **Step 3: Replace header-based `principal(request)`** in `moderator.ts` with the request decorator, retaining the enabled database lookup and current transactional registration behavior.
- [ ] **Step 4: Add bootstrap tests** proving first insert, repeated insert, and conflict with a disabled row preserve `disabled_at`; implement `ensureBootstrapModerator` with parameterized SQL.
- [ ] **Step 5: Run route/bootstrap tests** with `TEST_DATABASE_URL` configured and `npm run typecheck --workspace=@maxtown/api`; verify the prior registration approval/rejection cases still pass.
- [ ] **Step 6: Commit** as `feat(api): bind moderator access to enabled accounts`.

## Task 3: Serve Both Built Frontends from Fastify

**Files:**
- Modify: `apps/api/package.json`, `package-lock.json`, `apps/api/src/app.ts`
- Create: `apps/api/src/app.test.ts`

**Interfaces:**
- Extend `BuildAppOptions` with optional `staticAssets?: { miniAppRoot: string; adminRoot: string }` for production and fixture injection.
- Production roots resolve relative to `apps/api/src/index.ts` as `apps/miniapp/dist` and `apps/admin/dist`.
- Mini App `GET /` and unknown non-API navigation paths use the Mini App index; Admin `GET /admin` and unknown `/admin/*` navigation paths use the Admin index after the Basic Auth hook.
- Static files deny dotfiles; missing `/api/*` routes remain API 404 responses and never fall back to Mini App HTML.

- [ ] **Step 1: Write failing inject tests** using temporary Mini App/Admin roots, asserting `/` HTML, Mini App asset, `/admin/` challenge and authenticated HTML, Admin asset path, API route precedence, unknown API 404, missing static file behavior, and dotfile denial.
- [ ] **Step 2: Run** `npm test -- --run apps/api/src/app.test.ts`; confirm static routes are absent.
- [ ] **Step 3: Add `@fastify/static`** compatible with Fastify 5; register independent roots/prefixes with `decorateReply: false`, safe dotfile policy, and explicit SPA fallbacks that exclude `/api/*`.
- [ ] **Step 4: Make `/admin` resolve to `/admin/` only after authorization** and ensure all static paths under `/admin` are protected by Task 1.
- [ ] **Step 5: Run app/auth tests and API typecheck**; all fixture-based routing assertions pass.
- [ ] **Step 6: Commit** as `feat(api): serve mini app and admin assets`.

## Task 4: Fail-Closed Startup, Migrations, and Render Port

**Files:**
- Create: `apps/api/src/bootstrap.ts`, `apps/api/src/bootstrap.test.ts`
- Modify: `apps/api/src/index.ts`, `apps/api/src/app.ts`
- Modify: `apps/api/src/db/migrate.ts` only if needed to expose a testable startup dependency boundary.

**Interfaces:**
- Export `startServer(options)` from `bootstrap.ts`; it orders operations as: validate environment → create pool → `runMigrations(pool)` → `ensureBootstrapModerator(pool, MODERATOR_USERNAME)` → `buildApp` → `listen`. `index.ts` only imports and invokes `startServer(process.env)`.
- Port selection is `Number(env.PORT ?? env.API_PORT ?? 3000)`; reject non-integer or out-of-range values and listen on `0.0.0.0`.
- In production, require `DATABASE_URL`, `BOT_TOKEN`, `MODERATOR_USERNAME`, and `MODERATOR_PASSWORD_HASH`; a missing value or migration/bootstrap error closes the pool and rejects startup before listen.
- Signal shutdown continues to close Fastify and its pool exactly once.

- [ ] **Step 1: Add startup-order tests** with injected dependencies: migration completes before listen; migration rejection prevents listen and closes the pool; missing production secrets prevent pool/listen; `PORT` overrides `API_PORT`; invalid ports reject startup.
- [ ] **Step 2: Run** `npm test -- --run apps/api/src/bootstrap.test.ts`; confirm missing injectable startup behavior/test assertions.
- [ ] **Step 3: Implement `startServer` in `bootstrap.ts`** and make `index.ts` a thin entry point; call migrations and bootstrap before building/listening, and install one idempotent signal-close handler.
- [ ] **Step 4: Verify existing health/readiness behavior** remains available and database failure returns `503` from `/api/ready` after listen.
- [ ] **Step 5: Run startup tests, API typecheck, and migration tests**; all pass. Do not claim live Render readiness yet.
- [ ] **Step 6: Commit** as `feat(api): migrate before serving render traffic`.

## Task 5: Build One Deployable API Image

**Files:**
- Modify: `apps/api/Dockerfile`
- Modify: `apps/api/package.json` only if the runtime command needs adjustment.

**Interfaces:**
- The image builds `@maxtown/miniapp` and `@maxtown/admin` from the lockfile, then contains their `dist` directories at the paths expected by Task 3.
- Runtime exposes `PORT` (documented default 3000), runs as the non-root `node` user, installs only production dependencies, and starts the existing TypeScript API entry point.
- Keep the bot Dockerfile/build available for optional local development, but do not include a bot service in Render Blueprint.

- [ ] **Step 1: Build the current API image** to capture the baseline command and inspect existing runtime size/build stages.
- [ ] **Step 2: Convert the API Dockerfile to dependency/build/runtime stages**; build both Vite workspaces and copy only runtime API/shared sources, required node modules, and both distributions.
- [ ] **Step 3: Build the image** with `docker build --file apps/api/Dockerfile --tag maxtown-api:render .`.
- [ ] **Step 4: Start the image against a disposable PostgreSQL instance** with test-only valid auth variables; verify `/api/ready`, `/`, and the protected `/admin/` using HTTP requests.
- [ ] **Step 5: Commit** as `build(api): package frontends into render image`.

## Task 6: Replace VPS Compose with the Single-Service Smoke Topology

**Files:**
- Modify: `compose.yml`, `deploy/compose.smoke.yml`, `deploy/compose-smoke.sh`, `deploy/smoke.sh`, `deploy/deployment.test.ts`

**Interfaces:**
- Local production-like Compose topology is PostgreSQL plus one `web` container built from `apps/api/Dockerfile`; `web` serves both frontends and API.
- Compose injects `PORT=3000`, `DATABASE_URL`, `BOT_TOKEN`, `MODERATOR_USERNAME`, and `MODERATOR_PASSWORD_HASH`; migration/bootstrap run from web startup.
- `deploy/smoke.sh` accepts `BASE_URL`, `MODERATOR_SMOKE_USER`, and `MODERATOR_SMOKE_PASSWORD` without printing credentials; it checks Mini App HTML, health/readiness, invalid MAX `initData`, no-auth Admin challenge, authorized Admin HTML, spoof resistance, and protected Moderator API.

- [ ] **Step 1: Update `deploy/deployment.test.ts` assertions** first to expect the one-service topology and authenticated Moderator behavior; include no-secret output checks and remove assertions for VPS rollback/SSH/GHCR publishing.
- [ ] **Step 2: Run** `npm test -- --run deploy/deployment.test.ts`; confirm expected failures against the old Compose/workflow model.
- [ ] **Step 3: Remove separate API/Mini App/Admin/Caddy/migrate production services** from `compose.yml`; make `web` depend on healthy PostgreSQL and use the combined API image.
- [ ] **Step 4: Rewrite `deploy/compose-smoke.sh`** to build/use one image, generate a temporary test bcrypt hash, start a disposable Postgres and web stack, execute HTTP smoke, and clean only its unique Compose project and volume.
- [ ] **Step 5: Run** the clean Compose smoke command from CI with a locally built `maxtown-api` image; verify cleanup on both success and failure.
- [ ] **Step 6: Commit** as `build(deploy): align compose smoke with render service`.

## Task 7: Add the Render Free Blueprint and Deployment Guide

**Files:**
- Create: `render.yaml`, `deploy/render-blueprint.test.ts`
- Modify: root `package.json` and `package-lock.json` to add the direct YAML parser dependency; `.env.example`, `README.md`, `docs/deployment.md`.

**Interfaces:**
- Blueprint declares exactly one `type: web`, `runtime: docker`, `plan: free` service using `apps/api/Dockerfile`, health path `/api/ready`, and `autoDeployTrigger: checksPass`.
- Blueprint declares exactly one PostgreSQL item under the top-level `databases` key with `plan: free`, in the same region, and connects `DATABASE_URL` using `fromDatabase`.
- `BOT_TOKEN` and `MODERATOR_PASSWORD_HASH` use `sync: false`; document that later secret changes are made in Render Dashboard. `MODERATOR_USERNAME` has a non-secret default only if it agrees with the bootstrap behavior.
- Documentation gives Render Dashboard setup, MAX Mini App URL setup, Moderator bcrypt hash generation, smoke command, sleep behavior, 750-hour quota, and 30-day/14-day database deletion lifecycle.

- [ ] **Step 1: Add `yaml` as a direct root development dependency** and create a Blueprint contract test that parses YAML and asserts service/database count, Free plans, Dockerfile path, health path, `checksPass`, database reference, and `sync: false` secret declarations.
- [ ] **Step 2: Run** `npm test -- --run deploy/render-blueprint.test.ts`; confirm it fails because `render.yaml` is not present.
- [ ] **Step 3: Add `render.yaml`** with a stable region shared by both resources, one Render web service and one database, plus exact env wiring from the approved spec.
- [ ] **Step 4: Document setup and limitations** in the current deployment guide and update `.env.example` for local combined-server values without adding secrets.
- [ ] **Step 5: Run** `npm test -- --run deploy/render-blueprint.test.ts` and verify the YAML contract locally. `render blueprints validate render.yaml` is an authenticated Render API call that requires `render login` and a selected workspace; it is reserved for the account owner, never CI. Render resource creation is validated when the owner applies the Blueprint in Render Dashboard.
- [ ] **Step 6: Commit** as `feat(deploy): add render free blueprint`.

## Task 8: Make GitHub CI the Deployment Gate and Retire VPS Release Files

**Files:**
- Modify: `.github/workflows/ci.yml`, `deploy/deployment.test.ts`
- Delete: `.github/workflows/deploy.yml`, `Caddyfile`, `deploy/Caddyfile.smoke`, `deploy/deploy.sh`, and VPS-only test coverage after moving relevant smoke assertions to Task 6.
- Modify: `compose.yml` and deployment docs only if Task 6/7 left obsolete references.

**Interfaces:**
- Required GitHub CI checks include install, typecheck, database migrations/tests, workspace builds, combined API image build, optional bot image build, the no-secret YAML Blueprint contract test, and clean Compose smoke. The platform API validator remains an owner-side check because the CLI requires a Render login/workspace.
- Remove GHCR publication and VPS SSH deployment; Render is connected to the repository and waits for successful GitHub checks using `checksPass`.
- `render.yaml` is the source of truth for Render resources; no Render API token or deployment credential is needed in GitHub Actions.

- [ ] **Step 1: Update CI assertions** to build the combined API image once, keep the optional bot image build, validate `render.yaml`, and run the new one-service Compose smoke.
- [ ] **Step 2: Run** `npm test -- --run deploy/deployment.test.ts deploy/render-blueprint.test.ts`; confirm they fail against the old VPS workflow and service matrix.
- [ ] **Step 3: Delete the VPS-only workflow, Caddy gateway, and VPS deploy script**; retain the local Bot image build.
- [ ] **Step 4: Review all deployment references** with `rg -n 'VPS|GHCR|Caddy|workflow_run|workflow dispatch' README.md docs .github deploy compose.yml render.yaml` and update any obsolete release instructions.
- [ ] **Step 5: Run full verification**: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `docker build --file apps/api/Dockerfile --tag maxtown-api:ci .`, optional bot Docker build, YAML Blueprint contract test, and clean Compose smoke. Run Render's authenticated API validator manually only when the account owner has a configured CLI workspace.
- [ ] **Step 6: Commit** as `ci: gate render deploys on verified main`.

## Task 9: Review Release Readiness and Publish the Pull Request

**Files:**
- Review all files changed in Tasks 1–8; update final setup documentation if acceptance commands or limitations are unclear.

**Interfaces:**
- Local release acceptance is the CI workflow from Task 8.
- Hosted acceptance requires the account owner to connect the repository, apply the Blueprint, enter secrets, set the MAX Mini App URL, and provide the deployed `onrender.com` URL for smoke testing.
- A GitHub PR may be prepared after local CI passes; do not merge or state hosted deployment success until remote CI passes and hosted smoke checks succeed.

- [ ] **Step 1: Run `git diff --check` and review the complete diff** for accidental secrets, obsolete VPS instructions, changes outside the approved spec, and auth-path regressions.
- [ ] **Step 2: Run `superpowers:verification-before-completion` checks** before describing implementation as complete; capture exact local command results.
- [ ] **Step 3: Push the branch and open a draft PR** against `main` once GitHub authentication is available; attach the PR to the current Codex task.
- [ ] **Step 4: Confirm GitHub CI completes successfully** on the PR; repair any failures in the relevant task commit and wait for checks again.
- [ ] **Step 5: Provide the account-holder setup steps** for Render secrets/Blueprint/MAX URL; after the owner completes them and supplies the URL, run `deploy/smoke.sh` against the live service with Moderator smoke credentials supplied through environment variables.
- [ ] **Step 6: Mark release complete only after** PR checks pass, the Blueprint deploy is healthy, and hosted smoke passes; otherwise report the exact remaining owner action and avoid a hosted-success claim.

## Self-Review

- **Spec coverage:** Single Render service, static asset serving, moderator auth, enabled-principal authorization, bootstrap seed, migration-before-listen, `PORT`, Docker image, Compose smoke, Free-tier disclosures, Blueprint, CI gate, VPS/GHCR retirement, account-owner setup, hosted HTTP smoke, and release-reporting limits are all assigned to tasks.
- **Step scan:** Tasks have named files/interfaces, red-green checks, exact verification commands, and a commit boundary. Live Render deployment is explicitly separated from repository work because account access and secrets are owner-controlled.
- **Type consistency:** Task 1 defines `request.moderatorPrincipal`; Task 2 consumes it. Task 3 defines `staticAssets`; Task 5 supplies its matching asset roots. Task 4 defines startup ordering consumed by the Docker entry point and deployment smoke.
- **Review Focus tests:** Each of the five residual failure classes is assigned to a named test/verification step in Tasks 1–8.
- **Proportion:** This plan is longer than the design because it specifies independently reviewable Native implementation steps; it does not prescribe function bodies beyond decisions fixed by the spec.

## Current Platform References

- [Render Blueprint YAML reference](https://render.com/docs/blueprint-spec): Postgres resources belong under `databases`; `fromDatabase`, `sync: false`, Docker web services, and `checksPass` fields are documented there.
- [Render CLI](https://render.com/docs/cli): `render blueprints validate [BLUEPRINT_FILE]` validates against the selected Render workspace and requires authentication.
