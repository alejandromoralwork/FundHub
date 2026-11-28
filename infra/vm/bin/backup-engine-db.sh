#!/usr/bin/env bash
# Nightly backup of the databases (run as root by fundhub-engine-backup.timer): the VM's Postgres (engine,
#   Metabase) and, with WEBSITE_BACKUP_URL set, the website database on Neon.
#   Dumps fundhub_engine and, once Data Intelligence is installed, metabase (its users, questions and dashboards)
#   (pg_dump custom format, compressed) to $BACKUP_DIR, keeps $KEEP_DAYS days.
#   Optional off-VM copy: set RCLONE_REMOTE (e.g. "r2:fundhub-backups/engine") in /etc/default/fundhub-backup
#   and install/configure rclone. Restore: see infra/vm/README.md.
#   Optional copy of the engine files (filing PDFs, raw pages, captures): set RCLONE_FILES_REMOTE (e.g.
#   "r2:fundhub-files", and FILES_DIR if not /srv/fundhub-data/engine) — a SEPARATE bucket/path, never pruned
#   (RCLONE_REMOTE is pruned after KEEP_DAYS). Files never change, so `rclone copy` only uploads new ones.
set -euo pipefail
status=0
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

# Website database (Neon): Neon's own point-in-time restore covers only its restore window and lives in the same
# account. WEBSITE_BACKUP_URL = a read-only role that can read EVERY table (fundhub_backup, see infra/vm/README.md →
# Backups), on the DIRECT host (no "-pooler": pg_dump needs a session). Kept and copied like the engine dumps.
if [ -n "${WEBSITE_BACKUP_URL:-}" ]; then
  file="$BACKUP_DIR/website-$(date -u +%Y%m%d-%H%M).dump"
  url="$WEBSITE_BACKUP_URL"
  case "$url" in *sslrootcert=*) ;; *\?*) url="$url&sslrootcert=system" ;; *) url="$url?sslmode=verify-full&sslrootcert=system" ;; esac
  if pg_dump -Fc -Z 6 --no-owner --no-privileges -d "$url" -f "$file.part" && mv "$file.part" "$file" && pg_restore --list "$file" >/dev/null; then
    chown postgres:postgres "$file"
    echo "backup ok: $file ($(du -h "$file" | cut -f1))"
    if [ -n "${RCLONE_REMOTE:-}" ]; then rclone copy "$file" "$RCLONE_REMOTE" && echo "uploaded to $RCLONE_REMOTE"; fi
  else
    rm -f "$file.part"
    echo "website backup FAILED (check WEBSITE_BACKUP_URL, the fundhub_backup grants, pg_dump >= Neon's Postgres version)" >&2
    status=1
  fi
  find "$BACKUP_DIR" -name "website-*.dump" -mtime +"$KEEP_DAYS" -delete
fi

if [ -n "${RCLONE_REMOTE:-}" ]; then rclone delete "$RCLONE_REMOTE" --min-age "${KEEP_DAYS}d" || true; fi

# FILES_DIR: the engine's files on the data disk (blobs/docs = filing PDFs, blobs/raw = raw pages, captures/).
# All are written once and never changed (content-addressed or time-stamped), so `rclone copy --immutable`
# only uploads new files and never overwrites; nothing is ever deleted on the remote.
if [ -n "${RCLONE_FILES_REMOTE:-}" ]; then
  FILES_DIR="${FILES_DIR:-/srv/fundhub-data/engine}"
  if [ -d "$FILES_DIR" ]; then
    rclone copy "$FILES_DIR" "$RCLONE_FILES_REMOTE" --immutable --exclude "*.tmp" --transfers 8 && echo "engine files copied to $RCLONE_FILES_REMOTE"
  else
    echo "RCLONE_FILES_REMOTE set but $FILES_DIR does not exist (set FILES_DIR)" >&2
  fi
fi

exit "$status"
