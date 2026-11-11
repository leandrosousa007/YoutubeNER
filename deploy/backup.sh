#!/usr/bin/env sh
set -eu
umask 077
cd "$(dirname "$0")/.."
destino=${1:?Informe um diretório de backup}
mkdir -p "$destino"
arquivo="$destino/youtubener-$(date -u +%Y%m%dT%H%M%SZ).dump"
temporario=$(mktemp "$destino/.ytn-XXXXXX")
trap 'rm -f "$temporario"' EXIT HUP INT TERM
docker compose --env-file deploy/.env exec -T db sh -ec 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner --no-privileges --exclude-table-data=ytn_app.sessoes --exclude-table-data=ytn_app.limites' > "$temporario"
docker compose --env-file deploy/.env exec -T db pg_restore --list < "$temporario" >/dev/null
mv "$temporario" "$arquivo"
if [ -n "${YTN_BACKUP_REMOTE:-}" ]; then
    rclone copyto "$arquivo" "${YTN_BACKUP_REMOTE%/}/$(basename "$arquivo")"
fi
printf '%s\n' "$arquivo"
