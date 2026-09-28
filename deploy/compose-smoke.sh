#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
WEB_IMAGE=${1:?pass the combined API image tag}
project="maxtown-smoke-$RANDOM-$$"
temporary=$(mktemp -d)
port=$(node -e "const s=require('node:net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")
password='maxtown-smoke-only-password'
password_hash=$(SMOKE_PASSWORD="$password" node --input-type=module -e 'import bcrypt from "bcryptjs"; process.stdout.write(await bcrypt.hash(process.env.SMOKE_PASSWORD, 4))')
env_file="$temporary/.env"

cat > "$env_file" <<EOF
WEB_IMAGE=$WEB_IMAGE
POSTGRES_DB=maxtown
POSTGRES_USER=maxtown
POSTGRES_PASSWORD=maxtown-smoke-database-secret
DATABASE_URL=postgres://maxtown:maxtown-smoke-database-secret@postgres:5432/maxtown
BOT_TOKEN=maxtown-smoke-token
MODERATOR_USERNAME=smoke-moderator
POLL_VOTER_NULLIFIER_SECRET=maxtown-smoke-poll-voter-nullifier-secret-32-bytes
WEB_PUBLISH=127.0.0.1:$port:3000
EOF
printf "MODERATOR_PASSWORD_HASH='%s'\n" "$password_hash" >> "$env_file"

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
