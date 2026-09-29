#!/usr/bin/env bash
# Создаёт production .env: пользователь вводит только внешние ключи и пароль
# Модератора, внутренние секреты генерируются автоматически.
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET="$ROOT/.env"
force=0

fail() { printf 'MaxTown env: %s\n' "$*" >&2; exit 1; }
say() { printf 'MaxTown env: %s\n' "$*"; }

for argument in "$@"; do
  case "$argument" in
    --force) force=1 ;;
    *) fail "неизвестный аргумент $argument" ;;
  esac
done

[[ -t 0 ]] || fail 'запустите скрипт в интерактивном SSH-терминале'
command -v openssl >/dev/null || fail 'не найден openssl'
command -v htpasswd >/dev/null || fail 'не найден htpasswd (установите apache2-utils)'
if [[ -e "$TARGET" && $force == 0 ]]; then
  fail '.env уже существует; для осознанной замены используйте --force'
fi

read_visible() {
  local label=$1 default_value=${2:-}
  if [[ -n "$default_value" ]]; then
    read -r -p "$label [$default_value]: " REPLY
    REPLY=${REPLY:-$default_value}
  else
    read -r -p "$label: " REPLY
  fi
}

read_hidden() {
  local label=$1
  read -r -s -p "$label: " REPLY
  printf '\n'
}

safe_value() {
  local name=$1 value=$2
  [[ "$value" != *$'\n'* && "$value" != *$'\r'* && "$value" != *"'"* ]] || \
    fail "$name содержит недопустимый перенос строки или одинарную кавычку"
}

read_visible 'Домен без https://' 'maxtown.ru'; domain=$REPLY
[[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] || fail 'домен должен быть без схемы и пути'

read_hidden 'Токен бота MAX'; bot_token=$REPLY
[[ -n "$bot_token" ]] || fail 'токен бота MAX обязателен'

read_visible 'Имя бота MAX без @' 't25_hakaton_max_bot'; bot_username=${REPLY#@}
[[ "$bot_username" =~ ^[A-Za-z0-9_]+$ ]] || fail 'имя бота MAX содержит недопустимые символы'

read_hidden 'Серверный API-ключ DaData'; dadata_key=$REPLY
[[ -n "$dadata_key" ]] || fail 'ключ DaData обязателен'

read_hidden 'Ключ 2ГИС (Enter, чтобы пока отключить Ближайшие места)'; dgis_key=$REPLY

read_visible 'Логин Модератора' 'moderator'; moderator_username=$REPLY
[[ "$moderator_username" =~ ^[A-Za-z0-9._@-]+$ ]] || fail 'логин Модератора содержит недопустимые символы'
read_hidden 'Новый пароль Модератора (минимум 14 символов)'; moderator_password=$REPLY
[[ ${#moderator_password} -ge 14 ]] || fail 'пароль Модератора короче 14 символов'
read_hidden 'Повторите пароль Модератора'; moderator_password_repeat=$REPLY
[[ "$moderator_password" == "$moderator_password_repeat" ]] || fail 'пароли Модератора не совпадают'

for pair in \
  "DOMAIN:$domain" \
  "BOT_TOKEN:$bot_token" \
  "MAX_BOT_USERNAME:$bot_username" \
  "DADATA_API_KEY:$dadata_key" \
  "DGIS_API_KEY:$dgis_key" \
  "MODERATOR_USERNAME:$moderator_username"; do
  safe_value "${pair%%:*}" "${pair#*:}"
done

postgres_password=$(openssl rand -hex 32)
webhook_secret=$(openssl rand -hex 32)
internal_secret=$(openssl rand -hex 32)
poll_secret=$(openssl rand -hex 32)
moderator_hash=$(printf '%s\n' "$moderator_password" | htpasswd -niBC 12 "$moderator_username" | cut -d: -f2-)
moderator_hash=${moderator_hash/\$2y\$/\$2b\$}
unset moderator_password moderator_password_repeat

umask 077
temporary=$(mktemp "$ROOT/.env.tmp.XXXXXX")
cleanup() { rm -f "$temporary"; }
trap cleanup EXIT
{
  printf '# MaxTown production; создан deploy/prepare-env.sh. Не добавлять в git.\n'
  printf "DOMAIN='%s'\n" "$domain"
  printf "POSTGRES_DB='maxtown'\n"
  printf "POSTGRES_USER='maxtown'\n"
  printf "POSTGRES_PASSWORD='%s'\n" "$postgres_password"
  printf "COMPOSE_DATABASE_URL='postgres://maxtown:%s@postgres:5432/maxtown'\n" "$postgres_password"
  printf "BOT_TOKEN='%s'\n" "$bot_token"
  printf "MAX_BOT_USERNAME='%s'\n" "$bot_username"
  printf "MAX_WEBHOOK_SECRET='%s'\n" "$webhook_secret"
  printf "MAXTOWN_INTERNAL_SECRET='%s'\n" "$internal_secret"
  printf "DADATA_API_KEY='%s'\n" "$dadata_key"
  printf "DGIS_API_KEY='%s'\n" "$dgis_key"
  printf "MODERATOR_USERNAME='%s'\n" "$moderator_username"
  printf "MODERATOR_PASSWORD_HASH='%s'\n" "$moderator_hash"
  printf "POLL_VOTER_NULLIFIER_SECRET='%s'\n" "$poll_secret"
} > "$temporary"
chmod 600 "$temporary"
mv "$temporary" "$TARGET"
trap - EXIT

say '.env создан с правами 600; внутренние секреты и пароль PostgreSQL сгенерированы'
say 'после настройки DNS запустите: ./deploy/deploy.sh --no-pull'
