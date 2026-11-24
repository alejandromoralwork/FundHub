#!/usr/bin/env bash
# Nightly backup of the VM databases (run as root by fundhub-engine-backup.timer).
#   Dumps fundhub_engine and, once Data Intelligence is installed, metabase (its users, questions and dashboards)
#   (pg_dump custom format, compressed) to $BACKUP_DIR, keeps $KEEP_DAYS days.
#   Optional off-VM copy: set RCLONE_REMOTE (e.g. "r2:fundhub-backups/engine") in /etc/default/fundhub-backup
#   and install/configure rclone. Restore: see infra/vm/README.md.
set -euo pipefail
[ -f /etc/default/fundhub-backup ] && . /etc/default/fundhub-backup
BACKUP_DIR="${BACKUP_DIR:-/var/backups/fundhub-engine}"
KEEP_DAYS="${KEEP_DAYS:-14}"
DBS="${DBS:-fundhub_engine metabase}"

mkdir -p "$BACKUP_DIR"
chown postgres:postgres "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
for DB in $DBS; do
  # metabase exists only after infra/vm/bin/metabase-install.sh.
  sudo -u postgres psql -qAtc "select 1 from pg_database where datname = '$DB'" | grep -q 1 || continue
  file="$BACKUP_DIR/$DB-$(date -u +%Y%m%d-%H%M).dump"
  sudo -u postgres pg_dump -Fc -Z 6 -d "$DB" -f "$file.part"
  mv "$file.part" "$file"
  # A dump that pg_restore cannot list is not a backup.
  sudo -u postgres pg_restore --list "$file" >/dev/null
  echo "backup ok: $file ($(du -h "$file" | cut -f1))"
  if [ -n "${RCLONE_REMOTE:-}" ]; then rclone copy "$file" "$RCLONE_REMOTE" && echo "uploaded to $RCLONE_REMOTE"; fi
  find "$BACKUP_DIR" -name "$DB-*.dump" -mtime +"$KEEP_DAYS" -delete
done
if [ -n "${RCLONE_REMOTE:-}" ]; then rclone delete "$RCLONE_REMOTE" --min-age "${KEEP_DAYS}d" || true; fi
