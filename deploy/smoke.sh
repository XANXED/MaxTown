#!/usr/bin/env bash
set -Eeuo pipefail

BASE_URL=${BASE_URL:-${1:-}}
[[ -n "$BASE_URL" ]] || { echo 'BASE_URL is required' >&2; exit 2; }
BASE_URL=${BASE_URL%/}
tmp_file=$(mktemp)
trap 'rm -f "$tmp_file"' EXIT

curl --fail --silent --show-error --max-time 15 "$BASE_URL/" -o "$tmp_file"
grep -qi 'MaxTown' "$tmp_file" || { echo 'Mini App HTML did not contain the expected title' >&2; exit 1; }
curl --fail --silent --show-error --max-time 15 "$BASE_URL/api/health" -o "$tmp_file"
grep -q '"status":"ok"' "$tmp_file" || { echo 'API health check failed' >&2; exit 1; }
curl --fail --silent --show-error --max-time 15 "$BASE_URL/api/ready" -o "$tmp_file"
grep -q '"status":"ok"' "$tmp_file" || { echo 'API readiness check failed' >&2; exit 1; }

auth_status=$(curl --silent --show-error --max-time 15 --output "$tmp_file" --write-out '%{http_code}' \
  --header 'Content-Type: application/json' --data '{"initData":"invalid-smoke-data"}' "$BASE_URL/api/auth/max")
[[ "$auth_status" == 401 ]] || { echo "MAX authentication rejection returned HTTP $auth_status, expected 401" >&2; exit 1; }

admin_status=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$BASE_URL/admin/")
[[ "$admin_status" == 401 ]] || { echo "Unauthenticated admin access returned HTTP $admin_status, expected 401" >&2; exit 1; }
if [[ -n "${MODERATOR_SMOKE_USER:-}" && -n "${MODERATOR_SMOKE_PASSWORD:-}" ]]; then
  curl --fail --silent --show-error --max-time 15 --user "$MODERATOR_SMOKE_USER:$MODERATOR_SMOKE_PASSWORD" "$BASE_URL/admin/" -o "$tmp_file"
  grep -qi 'MaxTown' "$tmp_file" || { echo 'Authenticated Moderator panel did not return its HTML' >&2; exit 1; }
fi
printf 'MaxTown smoke: Mini App, API health/readiness, MAX auth rejection and admin protection passed\n'
