#!/usr/bin/env bash
# Nightly backup: all databases + Nextcloud files. Keeps 14 days locally.
# Copy /var/backups/fundhub off the server too (e.g. Hetzner Storage Box with rsync).
set -euo pipefail
cd "$(dirname "$0")"
DEST=/var/backups/fundhub
STAMP=$(date +%F)
mkdir -p "$DEST"

docker compose exec -T db pg_dumpall -U postgres | gzip > "$DEST/postgres-$STAMP.sql.gz"
docker compose exec -T nextcloud php occ maintenance:mode --on >/dev/null
docker run --rm -v fundhub-tools_nextcloud-data:/data:ro -v "$DEST":/backup alpine \
  tar czf "/backup/nextcloud-$STAMP.tar.gz" -C /data .
docker compose exec -T nextcloud php occ maintenance:mode --off >/dev/null

find "$DEST" -type f -mtime +14 -delete
echo "$(date -Is) backup ok"
