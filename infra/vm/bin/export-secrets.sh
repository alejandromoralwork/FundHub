#!/usr/bin/env bash
# Bundle every secret that exists ONLY on this VM into one password-encrypted file, for your password manager.
#   sudo bash infra/vm/bin/export-secrets.sh            -> ~/fundhub-vm-secrets-YYYYMMDD.tar.gz.gpg
# It asks for a passphrase (twice): use a long one and store it in your password manager next to the file.
# Restore on a rebuilt VM (before or after install.sh; install.sh keeps existing secrets):
#   gpg -d fundhub-vm-secrets-YYYYMMDD.tar.gz.gpg | sudo tar -xzpf - -C /
#   then: sudo bash infra/vm/install.sh
# What it contains: see docs/secrets.md. Delete the .gpg file from the VM after downloading it.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
APP_USER="$(stat -c %U "$REPO")"; APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
OUT="$APP_HOME/fundhub-vm-secrets-$(date -u +%Y%m%d).tar.gz.gpg"
FILES=()
for f in /etc/authelia-secrets /etc/authelia/users.yml /etc/fundhub-drive/secrets.env \
         "$REPO/services/engine/.env" "$REPO/packages/engine-db/.env" "$REPO/services/scraper/.env" \
         "$APP_HOME/.config/code-server/config.yaml" /etc/default/fundhub-backup; do
  [ -e "$f" ] && FILES+=("${f#/}") || echo "  (not present, skipped: $f)"
done
echo "Encrypting ${#FILES[@]} items. Choose a passphrase:"
tar -czpf - -C / "${FILES[@]}" | gpg --symmetric --cipher-algo AES256 --pinentry-mode loopback -o "$OUT"
chown "$APP_USER:" "$OUT"; chmod 600 "$OUT"
echo "Written: $OUT"
echo "Download it (code-server: right-click > Download), store it with the passphrase in your password manager,"
echo "then delete it here: rm $OUT"
