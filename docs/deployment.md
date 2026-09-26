# Production deployment

MaxTown deploys to one Docker Compose VPS. GitHub Actions runs the full CI suite, publishes four GHCR images, records their immutable SHA-256 digests, and deploys only after CI succeeds on `main`. Caddy terminates HTTPS and protects the Moderator panel and Moderator API with Basic Auth. PostgreSQL has a persistent named volume and is never published on a host port.

## VPS preparation

Prepare a Linux VPS with Docker Engine and the Docker Compose v2 plugin. Point the domain's A/AAAA records to the VPS and allow inbound TCP 80/443 and UDP 443. Create `/opt/maxtown`, copy `.env.production.example` to `/opt/maxtown/.env`, fill every value, and set mode `600`:

```sh
sudo install -d -m 750 /opt/maxtown/releases
sudo install -m 600 .env.production.example /opt/maxtown/.env
sudoedit /opt/maxtown/.env
```

Use the same URL-safe random value in `POSTGRES_PASSWORD` and the `DATABASE_URL` password. Generate one with `openssl rand -base64 36 | tr '/+' '_-' | tr -d '='`. Do not put URL-reserved characters in this password unless percent-encoding them in `DATABASE_URL`.

Generate the Moderator hash on a trusted machine with `caddy hash-password`, then put the complete result in the single-quoted `MODERATOR_PASSWORD_HASH` value. Use a long unique password and keep its plaintext in the organization's password manager. The matching username is the authenticated Caddy principal sent to the API.

Log the VPS into GHCR using an account with read-only `read:packages` access so Compose can pull private images. Keep the token outside the release directory and restrict its Docker config permissions. The optional Bot container is not started by the default deployment; its digest and token are still provisioned for a consistent release manifest and server-side MAX authentication.

## GitHub configuration

Create a GitHub Environment named `production`. Add these environment secrets:

| Secret | Purpose |
| --- | --- |
| `VPS_HOST` | VPS DNS name or IP |
| `VPS_USER` | Deployment account, allowed to run Docker Compose |
| `VPS_SSH_PRIVATE_KEY` | Dedicated deployment key |
| `VPS_SSH_KNOWN_HOSTS` | Pre-verified host key line; do not collect trust with unauthenticated `ssh-keyscan` in the workflow |

Add environment variables `VPS_PORT` (usually `22`) and `MAINTOWN_ROOT` (`/opt/maxtown`). Restrict who can approve or deploy to this Environment. Protect `main` with required CI checks and review before enabling deployment. The publish job has `packages: write`; the CI job retains read-only repository permissions.

The workflow uses only SHA-pinned third-party Actions, publishes `api`, `miniapp`, `admin`, and `bot` image manifests, and passes `ghcr.io/...@sha256:...` references to the host. The deploy script rejects tags and non-GHCR image references.

## First release and Moderator bootstrap

Push a reviewed commit to `main`. After the CI job succeeds, the workflow publishes the images, copies the deployment bundle into `/opt/maxtown/releases/<commit>`, and runs `deploy/deploy.sh` over SSH. It waits for PostgreSQL, applies forward-compatible migrations, waits for API/readiness and static-server health checks, then runs the external HTTPS smoke checks. Caddy obtains and renews the certificate automatically.

After the first successful deployment, create the Moderator row for the configured Caddy username. Run the command on the VPS, replacing the username with its configured value:

```sh
docker compose --project-name maxtown --env-file /opt/maxtown/.env \
  --file /opt/maxtown/releases/COMMIT/compose.yml \
  exec -T postgres psql -U maxtown -d maxtown \
  -c "INSERT INTO moderators (principal) VALUES ('moderator') ON CONFLICT (principal) DO NOTHING"
```

The password hash only authenticates at Caddy. Moderator access is granted only when that exact username also has an enabled row in `moderators`.

## Health checks and rollback

`deploy/smoke.sh https://<domain>` checks the Mini App response, `/api/health`, database-backed `/api/ready`, rejection of invalid MAX `initData`, and unauthenticated protection of `/admin/`. Run it after any manual infrastructure change.

Before each upgrade the host writes a mode-600 `pg_dump` backup under `/opt/maxtown/backups`; a failed backup stops deployment before migrations begin. The host records the current release directory only after all checks pass. If a candidate fails, the script re-pulls the previous digest-pinned images using the previous Compose bundle and repeats health/smoke checks. It reports failure even when rollback succeeds, so the GitHub deployment is never shown as successful for a reverted release. PostgreSQL data is retained; the deploy script never runs `down -v` or removes volumes.

Database changes must follow expand/migrate/contract: a release's schema migration must remain compatible with the currently deployed image until the new image is healthy. The append-only audit trigger is additive. Take a PostgreSQL backup before a release that changes data shape:

```sh
docker compose --project-name maxtown --env-file /opt/maxtown/.env \
  --file /opt/maxtown/releases/COMMIT/compose.yml \
  exec -T postgres pg_dump -U maxtown maxtown > maxtown-$(date -u +%Y%m%dT%H%M%SZ).sql
```

Keep backups off the VPS and periodically test restoration into a separate database. Old release directories can be removed after the retention window, but keep the current and previous release bundles and their image digests.

## Optional MAX bot

The `bot` Compose service has a `bot` profile and is not started by normal deployment. `BOT_TOKEN` remains required by the API for MAX `initData` validation even when the separate Bot process is disabled. To start that process after deployment, use the active Compose bundle and profile:

```sh
docker compose --project-name maxtown --profile bot --env-file /opt/maxtown/.env \
  --file /opt/maxtown/releases/COMMIT/compose.yml up -d bot
```

The Bot process and its GHCR image can be omitted from runtime when only the Mini App is needed; keep the token in the protected environment because API authentication depends on it.

## Local Compose validation

Copy `.env.production.example` to `.env`, supply local secrets and four valid image references, then validate the production topology without starting it:

```sh
docker compose --env-file .env config --quiet
```

`deploy/deploy.sh` validates the image manifest, Compose model, database migration completion, service health and external smoke test. Never use `docker compose down -v` against production.
