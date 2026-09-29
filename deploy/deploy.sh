#!/usr/bin/env bash
# Выкладка MaxTown на сервер Timeweb Cloud (docs/adr/0011, docs/deployment.md).
# Запускать на сервере из папки репозитория:
#   ./deploy/deploy.sh             — подтянуть код, забэкапить базу, пересобрать, проверить
#   ./deploy/deploy.sh --no-pull   — то же без git pull (выложить текущее состояние папки)
# Полная проверка живого адреса — если заданы MODERATOR_SMOKE_USER и
# MODERATOR_SMOKE_PASSWORD (в окружении, не в аргументах).
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"

fail() { printf 'MaxTown deploy: %s\n' "$*" >&2; exit 1; }
say() { printf 'MaxTown deploy: %s\n' "$*"; }

pull=1
for argument in "$@"; do
  case "$argument" in
    --no-pull) pull=0 ;;
    *) fail "неизвестный аргумент $argument" ;;
  esac
done

command -v docker >/dev/null || fail 'Docker не установлен'
docker compose version >/dev/null 2>&1 || fail 'нужен Docker Compose v2 (docker compose)'
[[ -s .env ]] || fail 'нет .env: скопируйте .env.production.example в .env и заполните'

# Значение из .env без выполнения файла как shell-скрипта.
env_value() { awk -F= -v wanted="$1" '$1 == wanted { sub(/^[^=]*=/, ""); gsub(/^'\''|'\''$/, ""); print; exit }' .env; }

for key in DOMAIN POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD COMPOSE_DATABASE_URL BOT_TOKEN MAX_WEBHOOK_SECRET \
  MAXTOWN_INTERNAL_SECRET DADATA_API_KEY MODERATOR_USERNAME MODERATOR_PASSWORD_HASH POLL_VOTER_NULLIFIER_SECRET; do
  [[ -n "$(env_value "$key")" ]] || fail "в .env не задан $key"
done
chmod 600 .env
domain=$(env_value DOMAIN)
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || fail "DOMAIN должен быть доменом без схемы и пути, например maxtown.ru"

if [[ $pull == 1 ]]; then
  say 'подтягиваю код'
  git pull --ff-only
fi

compose() { docker compose --project-name maxtown --file compose.yml --file compose.prod.yml "$@"; }
compose config --quiet

# Миграции идут при старте API — перед ними сохраняем базу, если она уже есть.
if [[ -n "$(compose ps --status running --quiet postgres 2>/dev/null)" ]]; then
  mkdir -p backups
  chmod 700 backups
  backup="backups/maxtown-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
  if ! compose exec --no-TTY postgres sh -ec 'pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB"' | gzip > "$backup"; then
    rm -f "$backup"
    fail 'бэкап базы не удался — выкладку останавливаю, миграции не запускались'
  fi
  chmod 600 "$backup"
  say "бэкап базы: $backup"
fi

say 'собираю и запускаю'
compose up --detach --build --wait --wait-timeout 300

say "проверяю https://$domain"
ready=0
for _ in $(seq 1 30); do
  if curl --fail --silent --max-time 10 "https://$domain/api/ready" >/dev/null; then ready=1; break; fi
  sleep 2
done
[[ $ready == 1 ]] || fail "https://$domain/api/ready не отвечает. Проверьте DNS, порты 80/443 и: docker compose -p maxtown logs caddy web"

if [[ -n "${MODERATOR_SMOKE_USER:-}" && -n "${MODERATOR_SMOKE_PASSWORD:-}" ]]; then
  BASE_URL="https://$domain" ./deploy/smoke.sh
else
  say 'полная проверка пропущена: задайте MODERATOR_SMOKE_USER и MODERATOR_SMOKE_PASSWORD, чтобы запускать deploy/smoke.sh'
fi
say "готово: https://$domain"
