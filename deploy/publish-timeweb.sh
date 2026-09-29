#!/usr/bin/env bash
# Безопасно синхронизирует код с Timeweb, не копируя локальный .env.
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
HOST=${MAXTOWN_DEPLOY_HOST:-root@200.165.226.232}
REMOTE_ROOT=${MAXTOWN_DEPLOY_PATH:-/opt/maxtown}
run_setup=0
run_deploy=0

fail() { printf 'MaxTown publish: %s\n' "$*" >&2; exit 1; }
say() { printf 'MaxTown publish: %s\n' "$*"; }

for argument in "$@"; do
  case "$argument" in
    --setup) run_setup=1 ;;
    --deploy) run_deploy=1 ;;
    *) fail "неизвестный аргумент $argument" ;;
  esac
done

[[ "$REMOTE_ROOT" == /opt/maxtown ]] || fail 'для защиты от ошибочного удаления MAXTOWN_DEPLOY_PATH должен быть /opt/maxtown'
command -v rsync >/dev/null || fail 'не найден rsync'
command -v ssh >/dev/null || fail 'не найден ssh'

ssh "$HOST" "install -d -m 0755 '$REMOTE_ROOT'"
say "синхронизирую код в $HOST:$REMOTE_ROOT"
rsync --archive --compress --delete-delay \
  --exclude='.env' \
  --exclude='.git/' \
  --exclude='backups/' \
  --exclude='node_modules/' \
  --exclude='**/node_modules/' \
  --exclude='dist/' \
  --exclude='**/dist/' \
  --exclude='.scratch/' \
  --exclude='test-results/' \
  --exclude='playwright-report/' \
  "$ROOT/" "$HOST:$REMOTE_ROOT/"

if [[ $run_setup == 1 ]]; then
  say 'подготавливаю Ubuntu-сервер'
  ssh "$HOST" "cd '$REMOTE_ROOT' && ./deploy/setup-timeweb.sh"
fi
if [[ $run_deploy == 1 ]]; then
  say 'запускаю production deploy'
  ssh "$HOST" "cd '$REMOTE_ROOT' && ./deploy/deploy.sh --no-pull"
fi
say 'код на сервере актуален; .env и backups не изменялись'
