#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=${MAINTOWN_ROOT:-/opt/maxtown}
RELEASE_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
IMAGE_FILE=${1:-"$RELEASE_DIR/images.env"}
ENV_FILE="$ROOT/.env"
CURRENT_RELEASE_FILE="$ROOT/current-release"

fail() { printf 'MaxTown deploy: %s\n' "$*" >&2; exit 1; }

[[ -s "$ENV_FILE" ]] || fail "missing protected environment file $ENV_FILE"
[[ -r "$IMAGE_FILE" ]] || fail "cannot read digest manifest $IMAGE_FILE"
command -v docker >/dev/null || fail 'Docker is not installed'
docker compose version >/dev/null || fail 'Docker Compose v2 is required'

# Never source this generated file as shell. Parse only the four expected values.
declare -A image_refs=()
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  case "$key" in
    API_IMAGE|MINIAPP_IMAGE|ADMIN_IMAGE|BOT_IMAGE) ;;
    *) fail "unexpected key in digest manifest: $key" ;;
  esac
  [[ -n "$value" && "$value" != *[$'\r\n ']* ]] || fail "invalid digest value for $key"
  [[ "$value" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$ ]] || fail "$key must be a ghcr.io image pinned by sha256 digest"
  [[ -z "${image_refs[$key]+present}" ]] || fail "duplicate $key in digest manifest"
  image_refs[$key]=$value
done < "$IMAGE_FILE"

for key in API_IMAGE MINIAPP_IMAGE ADMIN_IMAGE BOT_IMAGE; do
  [[ -n "${image_refs[$key]:-}" ]] || fail "digest manifest is missing $key"
  export "$key=${image_refs[$key]}"
done

for key in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL BOT_TOKEN DOMAIN MODERATOR_USERNAME MODERATOR_PASSWORD_HASH; do
  if ! awk -F= -v wanted="$key" '$1 == wanted && length($0) > length(wanted) + 1 { found=1 } END { exit !found }' "$ENV_FILE"; then
    fail "$key must be set in $ENV_FILE"
  fi
done
chmod 600 "$ENV_FILE"

compose() {
  docker compose --project-name maxtown --env-file "$ENV_FILE" --file "$1/compose.yml" "${@:2}"
}

deploy_release() {
  local release=$1
  compose "$release" config --quiet || return
  compose "$release" pull api miniapp admin caddy || return
  compose "$release" up --detach --wait --wait-timeout 180 postgres api miniapp admin caddy || return
  local domain
  domain=$(awk -F= '$1 == "DOMAIN" { print $2; exit }' "$ENV_FILE")
  [[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || return 1
  BASE_URL="https://$domain" "$release/deploy/smoke.sh" || return
}

previous_release=''
if [[ -s "$CURRENT_RELEASE_FILE" ]]; then previous_release=$(cat "$CURRENT_RELEASE_FILE"); fi

if [[ -n "$previous_release" && -d "$previous_release" ]]; then
  backup_dir="$ROOT/backups"
  mkdir -p "$backup_dir"
  chmod 700 "$backup_dir"
  backup_file="$backup_dir/before-${RELEASE_DIR##*/}-$(date -u +%Y%m%dT%H%M%SZ).sql"
  if ! compose "$previous_release" exec --no-TTY postgres sh -ec 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' > "$backup_file"; then
    rm -f "$backup_file"
    fail 'database backup failed; refusing to start migrations'
  fi
  chmod 600 "$backup_file"
  printf 'MaxTown deploy: database backup saved as %s\n' "$backup_file"
fi

if ! deploy_release "$RELEASE_DIR"; then
  printf 'MaxTown deploy: candidate failed smoke/readiness checks\n' >&2
  if [[ "${MAINTOWN_ROLLBACK:-0}" != 1 && -n "$previous_release" && -d "$previous_release" ]]; then
    previous_images="$previous_release/images.env"
    [[ -r "$previous_images" ]] || fail 'previous release image manifest is missing; automatic rollback is unsafe'
    printf 'MaxTown deploy: restoring previous digest-pinned release\n' >&2
    if MAINTOWN_ROLLBACK=1 MAINTOWN_ROOT="$ROOT" "$previous_release/deploy/deploy.sh" "$previous_images"; then
      fail 'candidate failed; the previous release was restored'
    fi
    fail 'candidate and previous release both failed health checks; inspect the deployment host'
  fi
  fail 'there is no previous release to restore; candidate remains available for diagnosis'
fi

tmp_file="$CURRENT_RELEASE_FILE.tmp.$$"
printf '%s\n' "$RELEASE_DIR" > "$tmp_file"
chmod 600 "$tmp_file"
mv -f "$tmp_file" "$CURRENT_RELEASE_FILE"
printf 'MaxTown deploy: release is healthy at %s\n' "$RELEASE_DIR"
