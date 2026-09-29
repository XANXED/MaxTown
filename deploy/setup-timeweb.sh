#!/usr/bin/env bash
# Однократная подготовка чистого Ubuntu-сервера Timeweb для MaxTown.
set -Eeuo pipefail

fail() { printf 'MaxTown server: %s\n' "$*" >&2; exit 1; }
say() { printf 'MaxTown server: %s\n' "$*"; }

[[ ${EUID:-$(id -u)} == 0 ]] || fail 'запустите от root'
command -v apt-get >/dev/null || fail 'поддерживается Ubuntu/Debian с apt'

say 'устанавливаю Docker Compose и системные утилиты из репозитория Ubuntu'
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install --yes docker.io docker-compose-v2 ca-certificates curl openssl apache2-utils rsync git
systemctl enable --now docker

docker version >/dev/null
docker compose version >/dev/null
install -d -m 0755 /opt/maxtown

say "Docker: $(docker --version)"
say "Compose: $(docker compose version --short)"
say 'сервер готов; код должен находиться в /opt/maxtown'
