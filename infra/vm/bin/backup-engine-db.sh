#!/usr/bin/env bash
# Nightly backup of the engine database (run as root by fundhub-engine-backup.timer).
#   Dumps fundhub_engine (pg_dump custom format, compressed) to $BACKUP_DIR, keeps $KEEP_DAYS days.
#   Optional off-VM copy: set RCLONE_REMOTE (e.g. "r2:fundhub-backups/engine") in /etc/default/fundhub-backup
#   and install/configure rclone. Restore: see infra/vm/README.md.
set -euo pipefail
[ -f /etc/default/fundhub-backup ] && . /etc/default/fundhub-backup
BACKUP_DIR="${BACKUP_DIR:-/var/backups/fundhub-engine}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DB="${DB:-fundhub_engine}"

mkdir -p "$BACKUP_DIR"
chown postgres:postgres "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
file="$BACKUP_DIR/$DB-$(date -u +%Y%m%d-%H%M).dump"
sudo -u postgres pg_dump -Fc -Z 6 -d "$DB" -f "$file.part"
mv "$file.part" "$file"
# A dump that pg_restore cannot list is not a backup.
sudo -u postgres pg_restore --list "$file" >/dev/null
echo "backup ok: $file ($(du -h "$file" | cut -f1))"

if [ -n "${RCLONE_REMOTE:-}" ]; then
  rclone copy "$file" "$RCLONE_REMOTE" && echo "uploaded to $RCLONE_REMOTE"
  rclone delete "$RCLONE_REMOTE" --min-age "${KEEP_DAYS}d" || true
fi
find "$BACKUP_DIR" -name "$DB-*.dump" -mtime +"$KEEP_DAYS" -delete
