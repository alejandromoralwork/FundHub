#!/usr/bin/env bash
# Change an Authelia (VM 2FA) user's password.
#   sudo bash infra/vm/bin/authelia-passwd.sh [user]      (default: the user who ran sudo)
# Asks for the new password twice (not shown, not saved), writes its argon2 hash into /etc/authelia/users.yml,
# keeps a backup of the old file, and restarts Authelia. The authenticator app (TOTP) is not affected.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
USER_NAME="${1:-${SUDO_USER:-}}"
FILE=/etc/authelia/users.yml
grep -qE "^  ${USER_NAME}:\s*$" "$FILE" || { echo "User '$USER_NAME' not found in $FILE." >&2; exit 1; }

read -rsp "New password for $USER_NAME: " P1; echo
read -rsp "Repeat it: " P2; echo
[ "$P1" = "$P2" ] || { echo "Passwords differ, nothing changed." >&2; exit 1; }
[ "${#P1}" -ge 12 ] || { echo "Use at least 12 characters, nothing changed." >&2; exit 1; }

HASH="$(authelia crypto hash generate argon2 --password "$P1" | sed -n 's/^Digest: //p')"
unset P1 P2
[ -n "$HASH" ] || { echo "Could not hash the password, nothing changed." >&2; exit 1; }

cp -p "$FILE" "$FILE.bak"
# Replace the password line inside this user's block only.
HASH="$HASH" USER_NAME="$USER_NAME" python3 - "$FILE" <<'PY'
import os, re, sys
path, user, digest = sys.argv[1], os.environ["USER_NAME"], os.environ["HASH"]
lines = open(path).read().split("\n")
inside, done = False, False
for i, line in enumerate(lines):
    if re.match(r"^  \S+:\s*$", line):
        inside = line.strip() == user + ":"
    elif inside and re.match(r"^    password:", line):
        lines[i] = "    password: '" + digest + "'"
        done = True
if not done:
    sys.exit("password line not found")
open(path, "w").write("\n".join(lines))
PY
systemctl restart authelia
sleep 2
if systemctl is-active --quiet authelia; then
  rm -f /etc/authelia/initial-credentials
  echo "Password changed for $USER_NAME. Test it in a private window before closing your current session."
else
  cp -p "$FILE.bak" "$FILE"; systemctl restart authelia
  echo "Authelia did not start with the new file; the old password was restored." >&2; exit 1
fi
