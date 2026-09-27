# MaxTown VK Community Implementation Plan

> **For Native Codex execution:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task by task. Apply `superpowers:test-driven-development` for every behavior change and `superpowers:verification-before-completion` before claiming completion, committing a release, or attaching a PR.

**Goal:** Replace the MAX platform integration with a production-oriented VK Community Bot and VK Mini App, add anonymous house polls with resident notifications, maintain a house-specific service/provider directory, and preserve the existing house operations, repair mode, moderator flow, and Render Free deployment.

**Architecture:** Keep the current npm-workspace monorepo and its React/Vite Mini App, Fastify API, PostgreSQL, moderator Admin, shared contracts, and combined Render web service. VK is the only external platform identity: the API validates VK Mini App launch parameters, maps VK IDs to internal residents, and issues the existing hashed bearer sessions. Add VK Callback API handling and an in-process, transactional outbox sender to the API process; do not add a second always-on worker. Persist only HMAC voter nullifiers for ballots, never membership/user IDs. Poll visibility is house-scoped and exposes aggregates only. Add a manually maintained provider/service/tariff directory scoped to houses.

**Tech Stack:** Node.js 24+, TypeScript, npm workspaces, React, Vite, `@vkontakte/vkui`, `@vkontakte/vk-bridge`, Fastify, PostgreSQL, Vitest, Docker Compose, Render Blueprint, GitHub Actions.

**Approved spec:** `docs/superpowers/specs/2026-09-maxtown-vk-community-design.md`

**Global constraints:** Follow root `AGENTS.md`, `CONTEXT.md`, and `docs/adr/`; use Context7 for current library/API/CLI/cloud documentation (resolve library ID, then query docs); before editing any UI markup or CSS read `design/AGENTS.md` and adapt its MAX-specific provisions for the approved VK target; keep UI text Russian; use strict TypeScript and Node erasable syntax; never trust client-supplied VK identity; never map existing MAX IDs to VK IDs; never expose poll creator or ballot choice/identity through any API, logs, or Moderator UI; do not claim cryptographic anonymity from the service operator; do not add secrets to Git; do not rely on a second always-on process on Render Free; do not push, publish, change provider settings, or deploy production until the user has reviewed the concrete release and authorized that external action.

## Review Focus

- Confirm the official VK Mini App signature validation and Callback API secret/confirmation handling match current VK documentation; do not accept `VKWebApp` client data as proof of identity.
- Audit every poll query, response type, log, moderator view, and migration for author or ballot linkage. Verify the nullifier secret is mandatory in production, never logged, and unique per poll/resident.
- Verify the outbox records and sender are idempotent under retries, respect house boundaries and message permissions, and do not claim delivery when VK disallows direct messages.
- Check migration behavior on an existing database, especially the irreversible platform identity transition and vote unlinking; no production data exists yet, but retain old identifiers only if required for a safe reversible migration and never use them for authentication.
- Confirm free-tier deployment remains one web process plus private PostgreSQL and CI remains the sole release gate; account for service sleep and the fact that live VK/Render acceptance requires owner-provided credentials/configuration.

## Task 1: Replace MAX identity with verified VK Mini App authentication

**Files:** `apps/api/src/auth/max-init-data.ts`, `apps/api/src/auth/max-init-data.test.ts`, `apps/api/src/routes/auth.ts`, `apps/api/src/routes/auth.test.ts`, `apps/api/src/bootstrap.ts`, `apps/api/src/bootstrap.test.ts`, `apps/miniapp/src/maxUser.ts`, `apps/miniapp/src/maxUser.test.ts`, `apps/miniapp/src/auth/session.ts`, `apps/miniapp/src/auth/session.test.ts`, `apps/miniapp/src/network.ts`, `apps/miniapp/src/main.tsx`, `apps/miniapp/src/max-bridge.d.ts`, `packages/shared/src/index.ts`, `apps/api/src/db/migrations/0003_vk_identity.sql`.

**Interfaces:** Add a server-only VK launch-parameter verifier with explicit app ID, HMAC signature, constant-time signature comparison, and a typed verified-user result. Add an auth endpoint accepting raw VK launch parameters and returning the existing session response only after server verification. The documented signed payload has no guaranteed expiry field; do not invent a timestamp requirement. Keep resident/session internal IDs stable; replace `max_user_id` identity with a VK external identity field/table. Store VK messaging permission state and consent time per resident as required by the spec.

1. Write failing verifier tests for valid signatures, tampering, wrong app/secret, malformed input, duplicate fields, and timing-safe signature comparison boundaries. Run `npm test -- apps/api/src/auth/vk-launch-params.test.ts` (new test path) and confirm the expected red failure.
2. Use Context7/current official VK docs to confirm signature derivation and parameter canonicalization; because the documented payload has no guaranteed signed expiry timestamp, validate HMAC and configured app ID without inventing a freshness parameter. Implement the verifier in `apps/api/src/auth/vk-launch-params.ts` without importing VK secrets into browser code.
3. Add failing route tests for invalid launch data, first VK login, returning identity, resident with active membership, and no membership; implement API auth and session issuance. Preserve one-time/expiry/revocation behavior of `sessions.ts`.
4. Replace Mini App MAX bridge/user bootstrap with `@vkontakte/vk-bridge`; initialize bridge and obtain launch params through the documented mechanism, then exchange them for the API session. Keep local/dev fixture auth behind explicit non-production configuration only.
5. Create additive migration for VK identity and platform migration policy. Ensure an existing MAX identity cannot be silently treated as a VK identity and revoke sessions from the old platform. Update bootstrap environment validation and `.env.example` with names and safe placeholders, not values.
6. Run focused auth tests and typecheck for API, shared package, and Mini App. Expected: all new auth cases pass, no MAX auth symbols remain in active auth flow.
7. Commit: `feat(auth): authenticate residents through VK Mini Apps`.

## Task 2: Migrate the Mini App shell and project guidance to VK

**Files:** `AGENTS.md`, `CONTEXT.md`, `docs/adr/0002-roles-work-in-miniapp.md`, `design/AGENTS.md`, `design/themes.css`, `design/tokens.css`, `apps/miniapp/package.json`, `apps/miniapp/src/App.tsx`, `apps/miniapp/src/main.tsx`, `apps/miniapp/src/app.css`, `apps/miniapp/index.html`, `apps/miniapp/src/routes.test.ts`, `apps/miniapp/vite.config.ts`, `package-lock.json`, and any components importing `@maxhub/max-ui` or MAX bridge symbols discovered by `rg`.

**Interfaces:** Mini App must render inside VK using VKUI and bridge initialization, preserve current routes/data flows, and retain the Russian house-domain vocabulary. Establish VK theme/viewport adaptation through the bridge and VKUI provider, with an explicit browser fallback for local development.

1. Read `design/AGENTS.md`; amend its platform-specific integration constraints to VK while retaining token-only styling, layout/accessibility constraints, and Russian UI text. Read current VKUI and bridge docs using Context7.
2. Add/adjust tests for bridge initialization, browser fallback, route rendering, and auth-required behavior before changing shell components.
3. Replace MAX UI/bridge dependencies and imports with VKUI/bridge equivalents; update theme and safe-area/viewport integration using documented APIs. Do not redesign unrelated screens.
4. Update repo instructions, Context/domain notes, and ADR 0002 to state VK as the platform; remove stale MAX platform wording from active project instructions. Keep historical migration context explicit where needed.
5. Run Mini App tests, `npm run typecheck`, `npm run build`; expected: all routes build, no active `@maxhub/*` dependency/reference remains. `rg` should find MAX only in historical migration notes if any.
6. Commit: `feat(miniapp): migrate shell and UI to VK`.

## Task 3: Persist anonymous polls and house-scoped aggregate results

**Files:** `apps/api/src/db/migrations/0004_anonymous_poll_ballots.sql`, `apps/api/src/auth/poll-nullifier.ts`, `apps/api/src/auth/poll-nullifier.test.ts`, `apps/api/src/routes/community.ts`, `apps/api/src/routes/community.test.ts`, `packages/shared/src/index.ts`, `apps/miniapp/src/data/community.ts`, `apps/miniapp/src/data/community.test.ts`, `apps/miniapp/src/screens/CommunityScreen.tsx`, related community route/components, and moderator query/tests if poll data is presently included there.

**Interfaces:** Poll creation allowed to every active member of that house. Keep the creator reference only for internal abuse prevention/audit, but never expose it to residents, house roles, Moderator UI, or notification payloads. Each ballot stores `(poll_id, option_id, voter_nullifier)` only; the nullifier is `HMAC-SHA-256(POLL_VOTER_NULLIFIER_SECRET, pollId || stable internal membership ID)` and is unique per poll. It must not include or reference the membership ID in storage. Public API returns poll question, options, aggregate counts, total count, close time, and only the current voter's own selected option. The nullifier secret is mandatory in production and never logged.

1. Write migration/DB behavior tests for old vote unlinking, duplicate ballot prevention, poll-house consistency, and absence of membership FK/column from new ballots. Write failing nullifier tests for determinism, poll separation, and HMAC secret validation.
2. Implement the nullifier module and production boot check requiring a high-entropy secret. Never log it or expose it to web clients.
3. Update `readPolls`/vote handlers and shared response types. Keep vote insertion atomic and serialize close-time checks. Ensure no SELECT joins ballots to memberships; expose only the authenticated voter's own choice, never another voter's identity or choice.
4. Permit poll creation to all active members; validate trimmed unique options, question bounds, future close time, and membership to the requested house. Reject cross-house poll/option IDs.
5. Update Mini App poll create/vote/results UX to match anonymous aggregate contract. Verify moderator screens and diagnostics omit author and ballot data.
6. Run migration tests and focused community/API/Mini App tests. Expected: race test yields one ballot per membership/poll; aggregate counts are correct; no identity/choice linkage exists in DB contract or HTTP responses.
7. Commit: `feat(community): store anonymous poll ballots`.

## Task 4: VK bot callback, consent, and transactional notification outbox

**Files:** `apps/api/src/routes/vk-callback.ts` (new), `apps/api/src/routes/vk-callback.test.ts` (new), `apps/api/src/vk/client.ts` (new), `apps/api/src/vk/client.test.ts` (new), `apps/api/src/notifications/outbox.ts` (new), `apps/api/src/notifications/outbox.test.ts` (new), `apps/api/src/db/migrations/0005_vk_notification_outbox.sql`, `apps/api/src/routes/community.ts`, `apps/api/src/bootstrap.ts`, `apps/api/src/app.ts`, `apps/miniapp/src/App.tsx`, community notification data/screens, `apps/bot/**` (remove or repurpose only after checking references), and shared contracts.

**Interfaces:** Fastify hosts the VK Callback API confirmation and supported events using configured group ID, callback secret, and community token; reject secret mismatch and deduplicate provider events where applicable. A poll creation transaction inserts one outbox delivery per eligible active membership of that house, including the creator if eligible, with per-member delivery state, retry metadata, and idempotency key. Sender runs inside API process with bounded batch/lock behavior. Provide `VKWebAppAllowMessagesFromGroup` consent entry point; persist permission state and consent time per resident from the VK bridge result, then confirm delivery eligibility with documented VK API behavior and handle later revocation as permanent denial. The in-app feed is the guaranteed notification path.

1. Write failing callback tests for confirmation, valid/invalid secret, unsupported event, malformed body, and duplicate event; tests must show no arbitrary side effects on invalid requests.
2. Write failing outbox tests for atomic creation with poll, house scoping, no delivery to other houses, retries, idempotency, permission denial, transient VK failure, and successful delivery.
3. Implement typed VK API client using official VK API docs and configured API version. Keep network errors bounded and redact tokens, launch data, message text, and resident identifiers from logs.
4. Add transaction/outbox schema and sender lifecycle hooks; ensure graceful shutdown and no overlapping send loops within a process. Render Free sleep means processing resumes only while service is awake; document this product limitation.
5. Add in-app notification feed for new polls and its deep link; expose VK permission prompt with Russian explanation and a durable opt-out/denied state. Do not promise direct messages for residents who have not enabled them.
6. Update or remove the current trivial separate `apps/bot` service/container if it conflicts with the single-service design; ensure all required inbound/outbound bot behavior is hosted in the API process and there is one Render web service only.
7. Run focused callback, outbox, community, and notification tests. Expected: delivery records are atomic and idempotent; invalid VK callbacks cannot enqueue; unavailable direct messaging never suppresses in-app notices.
8. Commit: `feat(bot): notify house members about new polls`.

## Task 5: House-specific provider and service directory

**Files:** `apps/api/src/db/migrations/0006_house_service_directory.sql` (new), `apps/api/src/routes/services-directory.ts` (new), `apps/api/src/routes/services-directory.test.ts` (new), `packages/shared/src/index.ts`, `apps/miniapp/src/data/directory.ts`, `apps/miniapp/src/data/directory.test.ts`, `apps/miniapp/src/screens/ServicesScreen.tsx`, `apps/miniapp/src/screens/ContactsScreen.tsx` if the approved information architecture calls for consolidation, and app route/navigation tests.

**Interfaces:** House-scoped directory entries expose category, provider, service state, tariff amount/currency/billing period/conditions/effective dates, contacts, source, last-checked date, and optional resident-facing notes. Any active resident can read. Only Headman/Responsible can create/update; requests require source and checked date for tariff facts. No scraping or claim of automated freshness.

1. Add failing route and data tests for house isolation, read permissions, role-gated edits, expired/current tariff representation, malformed prices/dates, and source/check date requirements.
2. Implement migration with referential integrity/indexes and API routes, using existing `findHouseAccess` authorization patterns.
3. Implement Mini App directory list/detail/edit states and stale/unchecked labels with Russian wording. Read design constraints before visual changes and use VKUI/tokens.
4. Run focused directory tests, Mini App tests, typecheck, and build; expected: cross-house reads/edits fail closed and tariff metadata is visible with provenance.
5. Commit: `feat(directory): add house provider and tariff catalog`.

## Task 6: Remove MAX bot/platform remnants and update deployment configuration

**Files:** `apps/bot/package.json`, `apps/bot/Dockerfile`, `apps/bot/src/index.ts`, `apps/miniapp/Dockerfile`, `apps/api/Dockerfile`, `compose.yml`, `render.yaml`, `.env.example`, `.gitignore`, `README.md`, `docs/agents/**`, `deploy/render-blueprint.test.ts`, `deploy/deployment.test.ts`, `deploy/compose.smoke.yml`, `deploy/compose-smoke.sh`, CI workflow under `.github/workflows/**`, and all stale MAX references found by repository-wide search.

**Interfaces:** Local Compose and Render use one web service serving Mini App, Moderator Admin, API, callback endpoint, and in-process outbox plus a private PostgreSQL database. Required production settings include VK app/group identifiers and secrets, VK API version, poll nullifier secret, session secret if applicable, and database URL. Health/readiness verifies configuration and DB without leaking values. CI remains the sole release gate and includes install, typecheck, database-backed tests, build, Render contract, Docker build, Compose smoke, and MCP package checks.

1. Search for all MAX-only packages, env vars, URLs, types, tests, docs, lock entries, and deployment services; classify each as remove, migrate, or historical context.
2. Write/adjust deployment tests first: exactly one web service, private DB, required secrets, no MAX bot worker, stable start/health checks, migration execution, and Render Free constraints.
3. Update containers, Compose, Render Blueprint, README, env example, and CI. Keep secrets absent from committed manifests; document dashboard configuration by variable name only.
4. Ensure migrations run safely on startup/one process and are serialized or otherwise protected against duplicate starts. Keep health endpoints’ semantics clear for Render.
5. Run `npm test`, `npm run typecheck`, `npm run build`, `npm run smoke:mcp`, Docker build, `docker compose config`, and Compose smoke as available. Fix environment-dependent test timeouts by removing unnecessary slow subprocess work or setting a scoped realistic test timeout; do not globally mask slow/hung tests.
6. Expected: clean MAX reference audit except explicitly documented migration history; CI contract matches deployment; local Compose builds and health checks pass.
7. Commit: `build(deploy): configure VK bot and Mini App release`.

## Task 7: Full verification, release preparation, hosted acceptance, and publication

**Files:** only fixes discovered by verification; release docs/runbook as needed.

1. Execute verification from a clean checkout or clean worktree state: `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run smoke:mcp`, `docker compose config`, Docker image build, database migration checks, Compose smoke, and repository secret scan. Record exact outputs/results in the release checklist.
2. Review end-to-end paths: VK launch verification → session → house membership; poll create → in-app notice/outbox → anonymous vote → aggregate results; house service directory read/edit; repair mode and registration/moderator flows remain intact.
3. Review security boundaries and migration rollback/backup guidance. Do not use real production data or credentials in local tests.
4. Create a release candidate branch commit set and draft PR only after all local checks pass. Publish/push only after user confirms that the release candidate and destination are ready; attach every created PR using the Codex artifact tool.
5. Hosted acceptance can be completed only when the owner configures VK application/community credentials and a Render service/database. Verify health/readiness, VK launch login, callback confirmation and event, consent and test message, migration status, poll creation/vote/outbox delivery, directory access, and logs. Do not call deployment complete before these live checks succeed.
6. Expected final state: passing GitHub release gate and verified hosted behavior, or a precise list of owner-side credentials/configuration blockers and already-passing CI evidence. Do not claim successful live CI/CD or publication without provider evidence.

## Plan Self-Review

- Spec coverage: VK-only identity, house-scoped community, all-resident poll creation, anonymous ballots and aggregate-only results, VK notification permissions and in-app fallback, provider/tariff directory, existing repair/registration/moderator behavior, Render Free, and CI/CD are each assigned to a task.
- Dependency order: identity precedes Mini App shell; anonymous poll data model precedes notifications; directory is independent after shared VK UI conventions; deployment integrates all prior changes; hosted acceptance is last.
- Test-first: each behavior-changing task starts with specific failing tests and expected focused commands. Final verification covers the full repository and release path.
- Security review: launch validation is server-only; sessions remain hashed; ballot identity is unlinked in storage; secrets are configured externally; callback/outbox logs are redacted; house membership guards every operation.
- Proportion: seven commits provide independently reviewable boundaries; no unrelated redesign or automatic provider scraping is included.
