# MaxTown production system Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a deployable MaxTown release with reproducible CI/CD, authenticated MAX Mini App sessions, persistent house membership, community messages and polls, and a per-house repair mode.

**Architecture:** Keep Fastify as the sole trust boundary, use PostgreSQL with versioned SQL migrations and parameterized `pg` queries, and have the Mini App call authenticated JSON endpoints. Deploy immutable GHCR image digests with Docker Compose behind Caddy; CI is the first code change, and production deployment follows only after repository and VPS access are available.

**Tech Stack:** Node.js 24+, npm workspaces, TypeScript, Fastify 5, PostgreSQL, `pg`, Vitest, React/Vite/`@maxhub/max-ui`, Docker Compose, Caddy, GitHub Actions, GHCR.

**Spec:** `docs/superpowers/specs/2026-09-community-auth-repair-cicd-design.md`

## Global Constraints

- Validate only the raw `window.WebApp.initData` on the API; never use `initDataUnsafe` for authentication.
- MAX `auth_date` freshness is at most one hour; bot credentials remain in `BOT_TOKEN` and never enter client bundles.
- Store only hashes of opaque session tokens and invitation codes; keep Mini App session tokens in memory, not `localStorage`.
- Derive house scope and roles from the verified session and membership; ignore client-supplied house IDs as authority.
- Preserve `CONTEXT.md`, ADR-0001, and ADR-0002 terminology and role boundaries; all UI copy is Russian.
- Mini App CSS must follow `design/AGENTS.md`, use `@maxhub/max-ui` and design tokens, and must not call `WebApp.ready()`.
- Use Node erasable TypeScript syntax and `.ts` extensions in relative Node imports; use parameterized SQL.
- Never commit secrets, real credentials, private keys, or production environment files.
- Polls are informal only; repair mode is not an externally verified contractor/management-company status.
- CI runs before feature work; deployment uses immutable image digests, restricted GitHub permissions, and a production Environment.

## Review Focus

- Duplicate, missing, malformed, tampered, stale, or future-dated MAX initData must fail closed — Task 3 tests each category.
- Concurrent invitation redemption, reissue, and join decisions must not create duplicate or cross-apartment memberships — Task 4 exercises transactional conflicts.
- A client-provided house ID must never grant cross-house community, poll, or repair access — Tasks 5 and 6 exercise foreign-house IDs.
- Parallel votes, closed polls, and role changes must preserve one immutable vote per membership — Task 5 exercises duplicate/concurrent votes and close time.
- Failed health checks or smoke checks during deployment must prevent traffic switching and restore the prior digest when migrations are compatible — Task 7 exercises deployment scripts against a local Compose stack.

---

### Task 1: Establish CI and buildable service containers

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.dockerignore`
- Create: `apps/api/Dockerfile`
- Create: `apps/miniapp/Dockerfile`
- Modify: `apps/api/package.json`
- Modify: `package.json`
- Test: existing workspace suite plus Docker build checks

**Interfaces:**
- Produces: CI checks named `install`, `typecheck`, `test`, `build`, and Docker image builds for API and Mini App; build contexts remain repository root.
- Consumes: existing npm workspace scripts; no PostgreSQL-backed test contract exists yet.

- [ ] **Step 1: Write a workflow contract check** that reads `.github/workflows/ci.yml` and asserts pinned action SHAs, `npm ci`, minimal `permissions`, and the required check names.
- [ ] **Step 2: Run the focused contract test** with `npm test -- --reporter=dot`; expected: FAIL because the workflow does not exist.
- [ ] **Step 3: Add CI and container build definitions.** Pin third-party actions to reviewed full commit SHAs, use Node 24, run the existing checks on pull requests and pushes, and add root-context Dockerfiles that build from npm workspaces without copying `.env` or fixtures into runtime images.
- [ ] **Step 4: Run the contract test, `npm run typecheck`, `npm test`, `npm run build`, and `docker build` for both images.** Expected: all checks pass; if Docker is unavailable locally, record that and rely on the workflow's buildx job only after GitHub becomes reachable.
- [ ] **Step 5: Commit** as `ci: add workspace checks and service image builds`.

### Task 2: Add PostgreSQL migrations and API persistence lifecycle

**Files:**
- Create: `apps/api/src/db/pool.ts`
- Create: `apps/api/src/db/migrate.ts`
- Create: `apps/api/src/app.ts`
- Create: `apps/api/src/db/migrations/0001_core.sql`
- Create: `apps/api/src/db/migrations.test.ts`
- Create: `apps/api/src/db/pool.test.ts`
- Modify: `apps/api/package.json`
- Modify: `apps/api/src/index.ts`
- Modify: `.env.example`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `createPool(databaseUrl: string): Pool`, `runMigrations(pool: Pool): Promise<void>`, and API app factory `buildApp(options: { pool: Pool; env: NodeJS.ProcessEnv }): Promise<FastifyInstance>`.
- Consumes: Task 1 CI and API runtime image; integration tests use `TEST_DATABASE_URL` pointing to a disposable PostgreSQL database.

- [ ] **Step 1: Add migration and health tests** asserting migration idempotence, `/health` liveness, `/ready` database readiness, and clean pool close.
- [ ] **Step 2: Run the API tests**; expected: FAIL because persistence and app factory do not exist.
- [ ] **Step 3: Implement a migration runner** using a PostgreSQL advisory lock, a schema-migrations table, and ordered SQL files; create core tables for residents, houses, apartments, memberships, invitations, join requests, moderator identities, registrations, sessions, community messages, polls/options/votes, repair mode, and audit events with the ownership and uniqueness constraints from the spec.
- [ ] **Step 4: Refactor startup to `buildApp`,** add database liveness/readiness behavior, graceful shutdown, and Postgres service plus migration/test steps in CI. Fetch current Fastify and node-postgres documentation through Context7 before coding their lifecycle/plugin APIs.
- [ ] **Step 5: Run API integration tests against PostgreSQL, `npm run typecheck`, and `npm test`.** Expected: migrations can run twice and all API tests pass.
- [ ] **Step 6: Commit** as `feat(api): add postgres migrations and readiness`.

### Task 3: Implement MAX authentication and revocable sessions

**Files:**
- Create: `apps/api/src/auth/max-init-data.ts`
- Create: `apps/api/src/auth/sessions.ts`
- Create: `apps/api/src/routes/auth.ts`
- Create: `apps/api/src/auth/max-init-data.test.ts`
- Create: `apps/api/src/auth/sessions.test.ts`
- Create: `apps/api/src/routes/auth.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `packages/shared/src/*` (auth/me contracts in the existing shared entrypoint)
- Modify: `apps/miniapp/src/max-bridge.d.ts`
- Modify: `apps/miniapp/src/network.ts`
- Create: `apps/miniapp/src/auth/session.ts`

**Interfaces:**
- Produces: `validateMaxInitData(initData: string, botToken: string, now?: Date): MaxIdentity`; routes `POST /api/auth/max`, `POST /api/auth/logout`, `GET /api/me`; client `getSession(): string | null`, `setSession(token: string): void`, `clearSession(): void`.
- Consumes: Task 2 `buildApp`, pool, schema, and migration; all session lookups return resident identity and active house memberships with roles.

- [ ] **Step 1: Write validator tests** for official MAX HMAC vectors plus duplicate keys, missing hash/user/auth_date, tampered payload, malformed values, stale/future timestamps, and absent bot token.
- [ ] **Step 2: Run validator tests**; expected: FAIL because validator is absent.
- [ ] **Step 3: Implement strict MAX validation**: parse unique key/value pairs, build the documented check string, derive HMAC-SHA256 secret using `WebAppData`, compare hash in constant time, validate user JSON and `auth_date` no older than one hour and not in the future.
- [ ] **Step 4: Write and run session route tests**; expected: FAIL for token hash persistence, expiry, revoke, `/api/me`, and rejection of fake bearer tokens.
- [ ] **Step 5: Implement opaque cryptographic session creation and revocation** storing only SHA-256 token hashes; add shared contracts and a Mini App in-memory token store with API authorization headers.
- [ ] **Step 6: Run auth tests, `npm run typecheck`, and `npm test`.** Expected: no client code references `initDataUnsafe` for authentication and no token is persisted to browser storage.
- [ ] **Step 7: Commit** as `feat(auth): validate MAX initData and issue sessions`.

### Task 4: Persist house registration, invitations, joining, and moderator access

**Files:**
- Create: `apps/api/src/routes/houses.ts`
- Create: `apps/api/src/routes/moderator.ts`
- Create: `apps/api/src/auth/house-access.ts`
- Create: `apps/api/src/routes/houses.test.ts`
- Create: `apps/api/src/routes/moderator.test.ts`
- Modify: `apps/api/src/index.ts`
- Modify: `apps/miniapp/src/screens/JoinScreen.tsx`
- Modify: `apps/admin/src/App.tsx`
- Modify: `apps/admin/src/data/registrations.ts`
- Create: `Caddyfile`

**Interfaces:**
- Produces: authenticated registration, invite issue/reissue/redeem, join-request creation/decision, and moderator registration queue/approve/reject endpoints; moderator audit principal is accepted only from the Caddy-overwritten `X-MaxTown-Moderator` header after Basic Auth.
- Consumes: Task 3 identity/session middleware and Task 2 registration, membership, invitation, and join-request schema.

- [ ] **Step 1: Write transactional route tests** for invite hash storage/reissue/redeem races, pending join request approvals by apartment resident or headman for an empty apartment, duplicate membership prevention, moderator decisions, and rejection without moderator principal.
- [ ] **Step 2: Run house and moderator tests**; expected: FAIL because routes are absent.
- [ ] **Step 3: Implement house authorization and transactional endpoints** with per-route Fastify schemas and membership/role checks; include invitation regeneration and atomic approval creating the House and headman membership.
- [ ] **Step 4: Add Caddy Basic Auth protection** for admin UI and `/api/moderator/*`, strip incoming moderator identity, set a trusted principal only after authentication, and verify syntax against current official Caddy documentation via Context7.
- [ ] **Step 5: Connect existing JoinScreen and moderator registration queue** to these endpoints, preserving Russian copy and existing loading/error states; no credentials go into Vite variables.
- [ ] **Step 6: Run PostgreSQL route tests, typecheck, and workspace tests.** Expected: races leave one valid membership/invitation and moderator routes deny unauthenticated access.
- [ ] **Step 7: Commit** as `feat(houses): persist onboarding and moderator review`.

### Task 5: Deliver house community messages and informal polls

**Files:**
- Create: `apps/api/src/routes/community.ts`
- Create: `apps/api/src/routes/community.test.ts`
- Create: `apps/miniapp/src/data/community.ts`
- Create: `apps/miniapp/src/data/community.test.ts`
- Create: `apps/miniapp/src/screens/CommunityScreen.tsx`
- Modify: `apps/miniapp/src/App.tsx`
- Modify: `apps/miniapp/src/routes.ts`
- Modify: `packages/shared/src/*` (community contracts)
- Modify: `apps/api/src/index.ts`
- Modify: `CONTEXT.md`

**Interfaces:**
- Produces: `GET/POST /api/houses/:houseId/community/messages?before=&limit=`, `GET/POST /api/houses/:houseId/polls`, `POST /api/houses/:houseId/polls/:pollId/votes`, and `GET /api/houses/:houseId/polls/:pollId/results`; API derives authorized house from membership and cursor pages newest-first.
- Consumes: Task 3 session identity, Task 4 house-access policy, Task 2 community/poll tables.

- [ ] **Step 1: Add tests** for member-only access, foreign-house IDs, text-only message persistence, page bounds/cursors, creator role restrictions, duplicate/concurrent vote rejection, poll close time, and aggregate result counts.
- [ ] **Step 2: Run community tests**; expected: FAIL because routes are absent.
- [ ] **Step 3: Implement community and poll routes** with parameterized SQL, bounded schemas, one immutable vote per membership, and plain-text message responses.
- [ ] **Step 4: Add CommunityScreen and navigation** using existing MAX UI components and token-based styles; poll UI states explicitly label results informal and disallow edits after voting.
- [ ] **Step 5: Update `CONTEXT.md`** with the approved domain terms for the separate house community, community message, poll, and repair mode, preserving the distinction between poll and legally significant owner meetings.
- [ ] **Step 6: Run route and UI tests, typecheck, and workspace tests.** Expected: unauthorized cross-house requests and duplicate/late votes fail; UI renders messages as escaped text.
- [ ] **Step 7: Commit** as `feat(community): add house messages and polls`.

### Task 6: Deliver persistent repair mode

**Files:**
- Create: `apps/api/src/routes/repair-mode.ts`
- Create: `apps/api/src/routes/repair-mode.test.ts`
- Create: `apps/miniapp/src/data/repairMode.ts`
- Create: `apps/miniapp/src/data/repairMode.test.ts`
- Create: `apps/miniapp/src/screens/RepairModeScreen.tsx`
- Modify: `apps/miniapp/src/App.tsx`
- Modify: `apps/miniapp/src/routes.ts`
- Modify: `packages/shared/src/*` (repair mode contracts)
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Produces: `GET /api/houses/:houseId/repair-mode` and `PUT /api/houses/:houseId/repair-mode`; read access requires membership, writes require Headman or Responsible, and every change appends an audit event with actor/time.
- Consumes: Task 3 session identity, Task 4 house access, Task 2 repair-mode and audit tables, and Task 5's UI navigation conventions.

- [ ] **Step 1: Add tests** for inactive default, member reads, foreign-house IDs, role authorization, input validation, start/end transitions, expected completion time, and audit actor/time.
- [ ] **Step 2: Run repair-mode tests**; expected: FAIL because route and model are absent.
- [ ] **Step 3: Implement transactional repair mode route** ensuring one state per House and immutable audit history for activation, edit, and completion.
- [ ] **Step 4: Add Mini App read/edit screen** with Russian content that clearly identifies the information as house-provided and uses only approved design tokens/components.
- [ ] **Step 5: Run PostgreSQL route/UI tests, typecheck, and workspace tests.** Expected: all membership and role boundaries hold.
- [ ] **Step 6: Commit** as `feat(repair): add per-house repair mode`.

### Task 7: Compose deployment, immutable-image CD, rollback, and release checks

**Files:**
- Create: `compose.yml`
- Create: `deploy/Caddyfile`
- Create: `deploy/deploy.sh`
- Create: `deploy/smoke.sh`
- Create: `.github/workflows/deploy.yml`
- Create: `.env.production.example`
- Create: `docs/deployment.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `apps/api/Dockerfile`
- Modify: `apps/miniapp/Dockerfile`

**Interfaces:**
- Produces: Compose services for PostgreSQL, one-shot migrations, API, Mini App, protected admin, Caddy, and optional bot; deploy accepts immutable image digests and deploys a release directory over SSH; smoke checks API health, MAX auth rejection without valid initData, and authenticated domain paths when a fixture account is configured.
- Consumes: Tasks 1-6 images, migration runner, health/readiness endpoints, API contracts, and Caddy admin protection.

- [ ] **Step 1: Write deployment contract/smoke tests** for required services, persistent database volume, non-public API port, digest-only image references, secret requirements, backup of current release, and rollback on unhealthy candidate.
- [ ] **Step 2: Run deployment checks**; expected: FAIL because Compose and deploy workflow are absent.
- [ ] **Step 3: Implement Compose and Caddy topology** with PostgreSQL healthcheck/persistent volume, migration gate, internal API networking, TLS proxy, Mini App static serving, protected admin, optional bot profile, and environment-only secrets.
- [ ] **Step 4: Implement guarded deploy and rollback scripts**: pull exact GHCR digest, run compatible migrations, start candidate, verify readiness and smoke checks, then retain or restore the previous digest on failure. Fetch current Docker Compose and Caddy docs via Context7 for any version-sensitive syntax.
- [ ] **Step 5: Add restricted GHCR publish and production Environment deploy workflows** using pinned actions and SSH secrets; publish digest artifacts only after all CI checks pass.
- [ ] **Step 6: Run clean-volume `docker compose up`, migration replay, health/smoke checks, and `docker compose down -v` only for the disposable test stack; run full CI locally.** Expected: all required core services become healthy without optional bot secrets.
- [ ] **Step 7: Document secrets, DNS/TLS, backup/recovery, release and rollback.** Record unavailable GitHub/VPS prerequisites without fabricating a successful public deployment.
- [ ] **Step 8: Commit** as `ci: deploy digest-pinned release to compose VPS`.

### Task 8: Final release review and publication readiness

**Files:**
- Modify: any Critical/Important findings from review, with regression tests
- Create: `docs/release-checklist.md`

**Interfaces:**
- Consumes: all Tasks 1-7 artifacts and acceptance criteria in the spec.
- Produces: reviewed release checklist documenting CI result, image digest, migration state, smoke result, deployment URL, and any external blocker without asserting unverified results.

- [ ] **Step 1: Run final automated checks**: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, API migration/integration suite, both Docker builds, and clean Compose smoke test.
- [ ] **Step 2: Review the whole branch** against the spec, security boundaries, and Review Focus; fix Critical/Important findings with failing tests first, record deferred Minor findings.
- [ ] **Step 3: Publish the branch and open a PR** after valid GitHub access becomes available; attach the PR and record the actual CI run URL/status.
- [ ] **Step 4: Configure production GitHub Environment and VPS secrets outside Git**, deploy the exact image digests, then verify HTTPS, health, auth rejection/acceptance, community, poll, repair mode, and rollback evidence.
- [ ] **Step 5: Mark release complete only when external deployment checks pass;** if GitHub credentials, VPS, DNS, or secrets remain unavailable, leave the local branch ready and report those exact blocking inputs.

## Self-review

- Spec coverage: CI first (Task 1); schema and migrations (Task 2); MAX auth/session (Task 3); registration, invitation, join requests, moderator (Task 4); community/messages/polls (Task 5); repair mode (Task 6); Compose/CD/rollback (Task 7); final checks and GitHub publication/deployment (Task 8).
- Interface consistency: `buildApp({ pool, env })` precedes every route task; auth exposes identity/session middleware before house policy; house policy and schema precede community and repair routes; all consumer endpoints are listed in producer tasks.
- Review Focus cases have named tests in their owning tasks.
- Publication and live deployment are explicitly conditional on real credentials and infrastructure; no workflow status, URL, or deployment success can be inferred from a local build.
