#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 24.04 server (run as root from this infra/ folder):
#   bash setup.sh
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null; then
  echo "Installing Docker…"
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  cp .env.example .env
  secret() { openssl rand -base64 36 | tr -d '/+=' | head -c 40; }
  for key in POSTGRES_ROOT_PASSWORD NEXTCLOUD_DB_PASSWORD TWENTY_DB_PASSWORD LISTMONK_DB_PASSWORD \
             TWENTY_APP_SECRET TWENTY_ENCRYPTION_KEY NEXTCLOUD_ADMIN_PASSWORD LISTMONK_ADMIN_PASSWORD; do
    sed -i "s|^${key}=.*|${key}=$(secret)|" .env
  done
  chmod 600 .env
  echo "Created .env with generated secrets. Edit the domains and ACME_EMAIL now, then re-run this script."
  exit 0
fi

# Basic firewall: SSH and web only.
if command -v ufw >/dev/null; then
  ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443 >/dev/null; ufw --force enable >/dev/null
fi

chmod +x postgres-init/01-databases.sh backup.sh
docker compose pull
docker compose up -d

# Nightly backups at 02:30.
( crontab -l 2>/dev/null | grep -v fundhub-backup; echo "30 2 * * * cd $(pwd) && ./backup.sh >> /var/log/fundhub-backup.log 2>&1 # fundhub-backup" ) | crontab -

set -a; . ./.env; set +a
echo
echo "Started. First logins (credentials are in .env):"
echo "  Drive/Calendar/Tasks: https://${DRIVE_DOMAIN}  (user ${NEXTCLOUD_ADMIN_USER})"
echo "  CRM:                  https://${CRM_DOMAIN}    (create your workspace on first visit)"
echo "  Newsletter:           https://${NEWSLETTER_DOMAIN}/admin  (user ${LISTMONK_ADMIN_USER})"
echo "Next: follow infra/README.md to enable Nextcloud apps, create the Twenty API key and the Listmonk list."
