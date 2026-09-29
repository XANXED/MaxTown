#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL=${BASE_URL:-${1:-}}
[[ -n "$BASE_URL" ]] || { echo 'BASE_URL is required' >&2; exit 2; }
[[ -n "${MODERATOR_SMOKE_USER:-}" ]] || { echo 'MODERATOR_SMOKE_USER is required' >&2; exit 2; }
[[ -n "${MODERATOR_SMOKE_PASSWORD:-}" ]] || { echo 'MODERATOR_SMOKE_PASSWORD is required' >&2; exit 2; }
BASE_URL=${BASE_URL%/}
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT

curl --fail --silent --show-error --max-time 30 "$BASE_URL/" -o "$temporary/miniapp.html"
grep -qi 'MaxTown' "$temporary/miniapp.html" || { echo 'Mini App HTML did not contain the expected title' >&2; exit 1; }
miniapp_asset=$(grep -oE '(src|href)="[^"]*assets/[^"]+"' "$temporary/miniapp.html" | head -n 1 | sed -E 's/^(src|href)="([^"]+)"$/\2/')
[[ -n "$miniapp_asset" ]] || { echo 'Mini App HTML did not reference a built asset' >&2; exit 1; }
[[ "$miniapp_asset" == /* ]] || miniapp_asset="/$miniapp_asset"
curl --fail --silent --show-error --max-time 30 "$BASE_URL$miniapp_asset" -o /dev/null

curl --fail --silent --show-error --max-time 15 "$BASE_URL/api/health" -o "$temporary/health.json"
grep -q '"status":"ok"' "$temporary/health.json" || { echo 'API health check failed' >&2; exit 1; }
curl --fail --silent --show-error --max-time 15 "$BASE_URL/api/ready" -o "$temporary/ready.json"
grep -q '"status":"ok"' "$temporary/ready.json" || { echo 'API readiness check failed' >&2; exit 1; }

auth_status=$(curl --silent --show-error --max-time 15 --output "$temporary/max-auth.json" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data '{"initData":"invalid-smoke-data"}' "$BASE_URL/api/auth/max")
[[ "$auth_status" == 401 ]] || { echo "MAX authentication rejection returned HTTP $auth_status, expected 401" >&2; exit 1; }

admin_status=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' \
  --header 'X-MaxTown-Moderator: smoke-moderator' "$BASE_URL/admin/")
[[ "$admin_status" == 401 ]] || { echo "Unauthenticated Admin access returned HTTP $admin_status, expected 401" >&2; exit 1; }
curl --fail --silent --show-error --max-time 30 --user "$MODERATOR_SMOKE_USER:$MODERATOR_SMOKE_PASSWORD" \
  "$BASE_URL/admin/" -o "$temporary/admin.html"
grep -qi 'MaxTown' "$temporary/admin.html" || { echo 'Authenticated Moderator panel did not return its HTML' >&2; exit 1; }
admin_asset=$(grep -oE '(src|href)="[^"]*assets/[^"]+"' "$temporary/admin.html" | head -n 1 | sed -E 's/^(src|href)="([^"]+)"$/\2/')
[[ -n "$admin_asset" ]] || { echo 'Moderator panel HTML did not reference a built asset' >&2; exit 1; }
[[ "$admin_asset" == /* ]] || admin_asset="/$admin_asset"
curl --fail --silent --show-error --max-time 30 --user "$MODERATOR_SMOKE_USER:$MODERATOR_SMOKE_PASSWORD" \
  "$BASE_URL$admin_asset" -o /dev/null

bad_moderator_status=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' \
  --user "$MODERATOR_SMOKE_USER:incorrect-smoke-password" "$BASE_URL/api/moderator/registrations")
[[ "$bad_moderator_status" == 401 ]] || { echo "Invalid Moderator credentials returned HTTP $bad_moderator_status, expected 401" >&2; exit 1; }
curl --fail --silent --show-error --max-time 30 --user "$MODERATOR_SMOKE_USER:$MODERATOR_SMOKE_PASSWORD" \
  "$BASE_URL/api/moderator/registrations" -o "$temporary/registrations.json"
grep -q '"registrations"' "$temporary/registrations.json" || { echo 'Authenticated Moderator API did not return registrations' >&2; exit 1; }

printf 'MaxTown smoke: Mini App assets, API health/readiness, MAX auth rejection, and Moderator access passed\n'
