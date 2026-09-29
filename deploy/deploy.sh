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

pull=0
[[ -d .git ]] && pull=1
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
postgres_db=$(env_value POSTGRES_DB)
postgres_user=$(env_value POSTGRES_USER)
postgres_password=$(env_value POSTGRES_PASSWORD)
database_url=$(env_value COMPOSE_DATABASE_URL)
webhook_secret=$(env_value MAX_WEBHOOK_SECRET)
internal_secret=$(env_value MAXTOWN_INTERNAL_SECRET)
moderator_hash=$(env_value MODERATOR_PASSWORD_HASH)
poll_secret=$(env_value POLL_VOTER_NULLIFIER_SECRET)
[[ "$postgres_db" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail 'POSTGRES_DB содержит недопустимые символы'
[[ "$postgres_user" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || fail 'POSTGRES_USER содержит недопустимые символы'
[[ "$postgres_password" =~ ^[A-Za-z0-9]{32,}$ ]] || fail 'POSTGRES_PASSWORD должен содержать минимум 32 латинских буквы или цифры'
[[ "$database_url" == "postgres://$postgres_user:$postgres_password@postgres:5432/$postgres_db" ]] || \
  fail 'COMPOSE_DATABASE_URL не соответствует POSTGRES_DB, POSTGRES_USER и POSTGRES_PASSWORD'
[[ "$webhook_secret" =~ ^[A-Za-z0-9-]{5,256}$ ]] || fail 'MAX_WEBHOOK_SECRET имеет недопустимый формат'
[[ ${#internal_secret} -ge 32 ]] || fail 'MAXTOWN_INTERNAL_SECRET должен содержать минимум 32 символа'
[[ ${#poll_secret} -ge 32 ]] || fail 'POLL_VOTER_NULLIFIER_SECRET должен содержать минимум 32 символа'
case "$moderator_hash" in
  '$2a$'*|'$2b$'*|'$2y$'*) ;;
  *) fail 'MODERATOR_PASSWORD_HASH должен быть bcrypt-хешем' ;;
esac
[[ ${#moderator_hash} -eq 60 ]] || fail 'MODERATOR_PASSWORD_HASH должен быть полным bcrypt-хешем'

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

# Caddyfile смонтирован одним файлом: rsync и git заменяют файл новым, а
# запущенный контейнер продолжает видеть старый. Пересоздаём Caddy, только
# если конфиг в нём отличается от файла на диске (пара секунд без HTTPS).
if ! compose exec --no-TTY caddy cat /etc/caddy/Caddyfile 2>/dev/null | cmp --silent - Caddyfile; then
  say 'Caddyfile изменился — перезапускаю Caddy'
  compose up --detach --no-deps --force-recreate --wait --wait-timeout 120 caddy
fi

say "проверяю https://$domain"
ready=0
for _ in $(seq 1 30); do
  if curl --fail --silent --max-time 10 "https://$domain/api/ready" >/dev/null; then ready=1; break; fi
  sleep 2
done
[[ $ready == 1 ]] || fail "https://$domain/api/ready не отвечает. Проверьте DNS, порты 80/443 и: docker compose -p maxtown logs caddy web"

# Карта 2ГИС идёт через Caddy (/dgis/…). Если прокси не отвечает, мини-апп
# грузит карту напрямую — у Жильцов с VPN её не будет. Выкладку не
# останавливаем: 2ГИС может быть недоступен сам по себе.
if ! curl --fail --silent --max-time 20 --output /dev/null "https://$domain/dgis/mapgl/api/js"; then
  say "внимание: https://$domain/dgis/mapgl/api/js не отвечает — карта у Жильцов с VPN не загрузится. Проверьте: docker compose -p maxtown logs caddy"
fi

say 'регистрирую production webhook в MAX'
compose exec --no-TTY web node --input-type=module -e '
  const response = await fetch("http://127.0.0.1:3000/api/max/register", {
    method: "POST",
    headers: { "x-maxtown-internal-secret": process.env.MAXTOWN_INTERNAL_SECRET ?? "" },
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`MAX webhook registration failed: HTTP ${response.status} ${body}`);
    process.exit(1);
  }
  console.log(body);
' || fail 'MAX не принял webhook; проверьте BOT_TOKEN и логи web'

if [[ -n "${MODERATOR_SMOKE_USER:-}" && -n "${MODERATOR_SMOKE_PASSWORD:-}" ]]; then
  BASE_URL="https://$domain" ./deploy/smoke.sh
else
  say 'полная проверка пропущена: задайте MODERATOR_SMOKE_USER и MODERATOR_SMOKE_PASSWORD, чтобы запускать deploy/smoke.sh'
fi
say "готово: https://$domain"
