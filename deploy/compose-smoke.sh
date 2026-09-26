#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
API_IMAGE=${1:?pass local API image tag}
MINIAPP_IMAGE=${2:?pass local Mini App image tag}
ADMIN_IMAGE=${3:?pass local Moderator panel image tag}
BOT_IMAGE=${4:?pass local Bot image tag}
project="maxtown-smoke-$RANDOM-$$"
temporary=$(mktemp -d)
port=$(node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
password='maxtown-smoke-only-password'
password_hash=$(docker run --rm caddy:2-alpine caddy hash-password --plaintext "$password")
env_file="$temporary/.env"

docker run --rm \
  --env DOMAIN=localhost \
  --env MODERATOR_USERNAME=smoke-moderator \
  --env MODERATOR_PASSWORD_HASH="$password_hash" \
  --volume "$ROOT/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile

cat > "$env_file" <<EOF
API_IMAGE=$API_IMAGE
MINIAPP_IMAGE=$MINIAPP_IMAGE
ADMIN_IMAGE=$ADMIN_IMAGE
BOT_IMAGE=$BOT_IMAGE
POSTGRES_DB=maxtown
POSTGRES_USER=maxtown
POSTGRES_PASSWORD=maxtown-smoke-database-secret
DATABASE_URL=postgres://maxtown:maxtown-smoke-database-secret@postgres:5432/maxtown
BOT_TOKEN=maxtown-smoke-token
DOMAIN=localhost
MODERATOR_USERNAME=smoke-moderator
MODERATOR_PASSWORD_HASH='$password_hash'
CADDYFILE_PATH=$ROOT/deploy/Caddyfile.smoke
HTTP_PUBLISH=127.0.0.1:$port:80
HTTPS_PUBLISH=127.0.0.1:18443:443
HTTPS_UDP_PUBLISH=127.0.0.1:18443:443/udp
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
compose up --detach --wait --wait-timeout 180 postgres api miniapp admin caddy
compose run --rm migrate
BASE_URL="http://127.0.0.1:$port" MODERATOR_SMOKE_USER=smoke-moderator MODERATOR_SMOKE_PASSWORD="$password" "$ROOT/deploy/smoke.sh"
