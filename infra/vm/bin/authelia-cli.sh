#!/usr/bin/env bash
# Run Authelia's own command line against the VM's configuration (it needs the secret files).
#   sudo bash infra/vm/bin/authelia-cli.sh storage bans user list
#   sudo bash infra/vm/bin/authelia-cli.sh storage bans user revoke <user>
#   sudo bash infra/vm/bin/authelia-cli.sh storage bans ip list | revoke <ip>
#   sudo bash infra/vm/bin/authelia-cli.sh storage user totp delete <user>      (lost phone)
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
S=/etc/authelia-secrets
exec sudo -u authelia env \
  AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET_FILE=$S/jwt_secret \
  AUTHELIA_SESSION_SECRET_FILE=$S/session_secret \
  AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE=$S/storage_encryption_key \
  authelia "$@" --config /etc/authelia/configuration.yml
