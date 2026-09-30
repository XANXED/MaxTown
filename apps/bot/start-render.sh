#!/bin/sh
set -eu

if [ -z "${MAX_RU_CA_CERT_PEM:-}" ]; then
  echo 'MAX_RU_CA_CERT_PEM is required: add the official MAX/Minkomsvyaz CA certificate in Render environment variables.' >&2
  exit 1
fi
case "$MAX_RU_CA_CERT_PEM" in
  *'-----BEGIN CERTIFICATE-----'*'-----END CERTIFICATE-----'*) ;;
  *) echo 'MAX_RU_CA_CERT_PEM must contain a PEM certificate.' >&2; exit 1 ;;
esac

MAX_RU_CA_FILE="${TMPDIR:-/tmp}/maxtown-max-ru-ca.pem"
umask 077
printf '%s\n' "$MAX_RU_CA_CERT_PEM" > "$MAX_RU_CA_FILE"
export NODE_EXTRA_CA_CERTS="$MAX_RU_CA_FILE"
exec node apps/bot/src/render-main.ts
