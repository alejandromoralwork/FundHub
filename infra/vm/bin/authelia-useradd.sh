#!/usr/bin/env bash
# Add a person to the VM login (Authelia): code-server and the Drive.
#   sudo bash infra/vm/bin/authelia-useradd.sh <username> "<Display Name>" <email> [--admin]
# Without --admin they can open the Drive only. --admin also gives code-server, which is a root shell on the VM:
# only for people who may control the whole server.
# Asks for their first password twice (give it to them in person or through a password manager). On their first
# login Authelia asks them to register an authenticator app; the one-time code for that is written to
# /var/lib/authelia/notification.txt (there is no mail server): read it with sudo and give it to them.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ $# -eq 3 ] || [ "${4:-}" = "--admin" ] || { echo "Usage: $0 <username> \"<Display Name>\" <email> [--admin]" >&2; exit 1; }
NAME="$1"; DISPLAY="$2"; EMAIL="$3"; FILE=/etc/authelia/users.yml
GROUPS_LINE=""; [ "${4:-}" = "--admin" ] && GROUPS_LINE="    groups: ['admins']\n"
[[ "$NAME" =~ ^[a-z][a-z0-9._-]{1,31}$ ]] || { echo "Username: lowercase letters, digits, . _ - (2-32 chars)." >&2; exit 1; }
grep -qE "^  ${NAME}:\s*$" "$FILE" && { echo "User '$NAME' already exists (change its password with authelia-passwd.sh)." >&2; exit 1; }
read -rsp "First password for $NAME: " P1; echo
read -rsp "Repeat it: " P2; echo
[ "$P1" = "$P2" ] || { echo "Passwords differ, nothing changed." >&2; exit 1; }
[ "${#P1}" -ge 12 ] || { echo "Use at least 12 characters, nothing changed." >&2; exit 1; }
HASH="$(authelia crypto hash generate argon2 --password "$P1" | sed -n 's/^Digest: //p')"; unset P1 P2
[ -n "$HASH" ] || { echo "Could not hash the password." >&2; exit 1; }
cp -p "$FILE" "$FILE.bak"
printf "  %s:\n    displayname: '%s'\n    password: '%s'\n    email: '%s'\n$GROUPS_LINE" "$NAME" "${DISPLAY//\'/}" "$HASH" "$EMAIL" >>"$FILE"
systemctl restart authelia; sleep 2
if systemctl is-active --quiet authelia; then
  echo "Added $NAME ($([ -n "$GROUPS_LINE" ] && echo "Drive + code-server" || echo "Drive only")). They log in at https://<vm>/authelia/ and register an authenticator."
  echo "Remove access later: delete their block from $FILE and sudo systemctl restart authelia."
else
  cp -p "$FILE.bak" "$FILE"; systemctl restart authelia; echo "Authelia did not start; change undone." >&2; exit 1
fi
