#!/usr/bin/env bash
# FILE: infra/vm/bin/data-disk-setup.sh
# WHAT IT DOES: Puts the engine's files (filing PDFs and raw captures, "blobs") on a separate Azure data disk:
#   - finds the new disk (Azure LUN 0 by default), formats it ext4 with the label "fundhub-data" — ONLY if it is
#     empty (a disk with partitions or another filesystem is refused);
#   - mounts it at /srv/fundhub-data for good (fstab by label, nofail: the VM still boots if the disk is missing);
#   - moves services/engine/.engine-data/blobs there (verified file count), keeps the old folder as *.old;
#   - sets STORAGE_ROOT in services/engine/.env and restarts the engine services.
#   The database never holds the files: raw.documents / raw.fetches keep only the content hash and the storage
#   key (e.g. docs/ab/ab12….pdf), so moving the files only changes STORAGE_ROOT.
# USAGE: 1) Azure portal → VM → Disks → Create and attach a new disk (Standard SSD, 128 GB, LUN 0) → Save.
#        2) sudo bash infra/vm/bin/data-disk-setup.sh            (or: … /dev/sdX to name the disk yourself)
#        Safe to re-run: an already formatted "fundhub-data" disk is reused, nothing is formatted twice.
set -euo pipefail

LABEL=fundhub-data
MOUNT=/srv/fundhub-data
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../../.." && pwd)"
APP_USER=${APP_USER:-${SUDO_USER:-$(stat -c %U "$REPO")}}
ENV_FILE="$REPO/services/engine/.env"
OLD_BLOBS="$REPO/services/engine/.engine-data/blobs"
NEW_BLOBS="$MOUNT/engine/blobs"

[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
say() { printf '\n== %s\n' "$*"; }

say "Disk"
if blkid -L "$LABEL" >/dev/null 2>&1; then
  DEV=$(blkid -L "$LABEL")
  echo "already formatted: $DEV ($LABEL)"
else
  DEV=${1:-}
  if [ -z "$DEV" ]; then
    # Azure exposes data disks by LUN; the first data disk is lun0.
    DEV=$(readlink -f /dev/disk/azure/scsi1/lun0 2>/dev/null || true)
  fi
  [ -n "$DEV" ] && [ -b "$DEV" ] || { echo "No data disk found. Attach one in the Azure portal (LUN 0), or pass the device: $0 /dev/sdX" >&2; lsblk -o NAME,SIZE,TYPE,MOUNTPOINT,FSTYPE >&2; exit 1; }
  ROOTDEV=$(lsblk -no PKNAME "$(findmnt -no SOURCE /)" 2>/dev/null || true)
  [ "$(basename "$DEV")" != "$ROOTDEV" ] || { echo "$DEV is the OS disk: refusing." >&2; exit 1; }
  if [ -n "$(lsblk -no NAME "$DEV" | tail -n +2)" ] || [ -n "$(blkid -o value -s TYPE "$DEV" 2>/dev/null || true)" ]; then
    echo "$DEV has partitions or a filesystem: refusing to format it. Check with lsblk / blkid." >&2
    exit 1
  fi
  echo "formatting $DEV ($(lsblk -no SIZE "$DEV" | head -1)) as ext4, label $LABEL"
  mkfs.ext4 -q -L "$LABEL" -m 1 "$DEV"
fi

say "Mount $MOUNT"
mkdir -p "$MOUNT"
grep -q "^LABEL=$LABEL " /etc/fstab || echo "LABEL=$LABEL $MOUNT ext4 defaults,nofail,noatime 0 2" >>/etc/fstab
mountpoint -q "$MOUNT" || mount "$MOUNT"
df -h "$MOUNT" | tail -1
install -d -o "$APP_USER" -g "$APP_USER" -m 750 "$MOUNT/engine" "$NEW_BLOBS"

say "Move the engine files"
if [ -d "$OLD_BLOBS" ] && [ ! -L "$OLD_BLOBS" ]; then
  systemctl stop fundhub-capture fundhub-engine-worker 2>/dev/null || true
  rsync -a "$OLD_BLOBS"/ "$NEW_BLOBS"/
  a=$(find "$OLD_BLOBS" -type f | wc -l); b=$(find "$NEW_BLOBS" -type f | wc -l)
  [ "$b" -ge "$a" ] || { echo "copy incomplete ($b of $a files): nothing switched" >&2; systemctl start fundhub-capture fundhub-engine-worker; exit 1; }
  chown -R "$APP_USER:$APP_USER" "$NEW_BLOBS"
  mv "$OLD_BLOBS" "$OLD_BLOBS.old-$(date +%Y%m%d)"
  echo "moved $a files ($(du -sh "$NEW_BLOBS" | cut -f1)); the old folder is kept as $OLD_BLOBS.old-$(date +%Y%m%d) — delete it after checking"
else
  echo "nothing to move (no $OLD_BLOBS folder)"
fi

say "Engine setting STORAGE_ROOT"
touch "$ENV_FILE"
if grep -q '^STORAGE_ROOT=' "$ENV_FILE"; then sed -i "s#^STORAGE_ROOT=.*#STORAGE_ROOT=$NEW_BLOBS#" "$ENV_FILE"; else echo "STORAGE_ROOT=$NEW_BLOBS" >>"$ENV_FILE"; fi
grep -q '^STORAGE_DRIVER=' "$ENV_FILE" || echo "STORAGE_DRIVER=fs" >>"$ENV_FILE"
chown "$APP_USER:$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
grep -E '^STORAGE_(ROOT|DRIVER)=' "$ENV_FILE"

say "Restart"
systemctl restart fundhub-capture fundhub-engine-worker fundhub-engine-scheduler 2>/dev/null || true
systemctl --no-pager --plain is-active fundhub-capture fundhub-engine-worker | paste -sd' '
echo
echo "Done. Filing PDFs are stored under $NEW_BLOBS (content-addressed: docs/<2 chars>/<sha256>.pdf, each file once)."
echo "Backups: the database dump does not contain these files. Take an Azure snapshot of the disk, or set RCLONE_REMOTE."
