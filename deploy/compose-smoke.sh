#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WEB_IMAGE=${1:?pass the combined API image tag}
project="maxtown-smoke-$RANDOM-$$"
temporary=$(mktemp -d)
port=$(node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
password='maxtown-compose-smoke-generated-password'
env_file="$temporary/.env"

cat > "$env_file" <<EOF
WEB_IMAGE=$WEB_IMAGE
POSTGRES_DB=maxtown
POSTGRES_USER=maxtown
POSTGRES_PASSWORD=maxtown-smoke-database-secret
COMPOSE_DATABASE_URL=postgres://maxtown:maxtown-smoke-database-secret@postgres:5432/maxtown
VK_APP_ID=12345678
VK_APP_SECRET=maxtown-smoke-vk-app-secret
VK_GROUP_ID=123
VK_GROUP_TOKEN=maxtown-smoke-vk-group-token
VK_CALLBACK_SECRET=maxtown-smoke-callback-secret
VK_CALLBACK_CONFIRMATION_CODE=maxtown-smoke-confirmation
VK_API_VERSION=5.199
MODERATOR_USERNAME=smoke-moderator
MODERATOR_PASSWORD=$password
POLL_VOTER_NULLIFIER_SECRET=maxtown-smoke-poll-voter-nullifier-secret-32-bytes
WEB_PUBLISH=127.0.0.1:$port:3000
EOF

compose() {
  docker compose --project-name "$project" --env-file "$env_file" \
    --file "$ROOT/compose.yml" --file "$ROOT/deploy/compose.smoke.yml" "$@"
}

cleanup() {
  local status=$?
  if [[ $status -ne 0 ]]; then compose logs --no-color || true; fi
  compose down --volumes --remove-orphans || true
  rm -rf "$temporary"
  exit "$status"
}
trap cleanup EXIT

compose config --quiet
compose up --detach --wait --wait-timeout 180 postgres web
BASE_URL="http://127.0.0.1:$port" \
MODERATOR_SMOKE_USER=smoke-moderator \
MODERATOR_SMOKE_PASSWORD="$password" \
  "$ROOT/deploy/smoke.sh"
