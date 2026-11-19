#!/usr/bin/env bash
# FundHub Azure VM — install or update everything outside the repo from the files in infra/vm/.
#
#   sudo bash infra/vm/install.sh            apply (idempotent: safe to re-run after every pull)
#   sudo bash infra/vm/install.sh --diff     only show what differs between the repo and the VM
#
# Settings (environment, all optional):
#   DOMAIN=alejandro-code.centralindia.cloudapp.azure.com   public DNS name (Caddy HTTPS + Authelia cookie)
#   APP_USER=<owner of the repo checkout>                    Linux user that runs code-server and the engine
#   NODE_DIR=<dir with node>                                 default: newest nvm Node of APP_USER, else /usr/bin
#
# Secrets are generated on first install and never overwritten or printed:
#   /etc/authelia/secrets/*, /etc/authelia/users.yml (+ initial-credentials), ~/.config/code-server/config.yaml,
#   services/engine/.env (CAPTURE_TOKEN, ENGINE_DATABASE_URL), packages/engine-db/.env.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
DOMAIN="${DOMAIN:-alejandro-code.centralindia.cloudapp.azure.com}"
APP_USER="${APP_USER:-$(stat -c %U "$REPO")}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"
if [ -z "${NODE_DIR:-}" ]; then
  NODE_DIR="$(ls -d "$APP_HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  NODE_DIR="${NODE_DIR:-/usr/bin}"
fi
DIFF_ONLY=0
[ "${1:-}" = "--diff" ] && DIFF_ONLY=1

[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
[ -x "$NODE_DIR/node" ] || { echo "node not found in $NODE_DIR (set NODE_DIR)." >&2; exit 1; }

say() { printf '\n== %s\n' "$*"; }
rand() { openssl rand -hex 32; }
as_app() { sudo -u "$APP_USER" env PATH="$NODE_DIR:/usr/bin:/bin" HOME="$APP_HOME" "$@"; }
render() { sed -e "s#@REPO@#$REPO#g" -e "s#@USER@#$APP_USER#g" -e "s#@NODE_DIR@#$NODE_DIR#g" -e "s#@DOMAIN@#$DOMAIN#g" "$1"; }

# install_file <source> <dest> <mode> [owner]: render, show diff, copy when different. Returns 0 if changed.
CHANGED=()
install_file() {
  local src="$1" dst="$2" mode="$3" owner="${4:-root:root}" tmp
  tmp="$(mktemp)"; render "$src" >"$tmp"
  if [ -f "$dst" ] && [ ! -L "$dst" ] && cmp -s "$tmp" "$dst"; then rm -f "$tmp"; return 1; fi
  echo "-- $dst"; diff -u "$dst" "$tmp" 2>/dev/null | tail -n +3 || true
  if [ "$DIFF_ONLY" = 1 ]; then rm -f "$tmp"; return 0; fi
  install -D -m "$mode" -o "${owner%%:*}" -g "${owner##*:}" "$tmp" "$dst.new" && mv -f "$dst.new" "$dst"
  rm -f "$tmp"; CHANGED+=("$dst"); return 0
}

if [ "$DIFF_ONLY" = 1 ]; then
  say "Differences repo → VM (nothing is changed)"
  install_file "$HERE/caddy/Caddyfile" /etc/caddy/Caddyfile 644 || true
  install_file "$HERE/authelia/configuration.yml" /etc/authelia/configuration.yml 600 authelia:authelia || true
  install_file "$HERE/authelia/override.conf" /etc/systemd/system/authelia.service.d/override.conf 644 || true
  install_file "$HERE/postgres/fundhub.conf" /etc/postgresql/18/main/conf.d/fundhub.conf 644 || true
  install_file "$HERE/bin/backup-engine-db.sh" /usr/local/lib/fundhub/backup-engine-db.sh 755 || true
  install_file "$HERE/drive/config.yaml" /etc/fundhub-drive/config.yaml 644 || true
  for u in "$HERE"/systemd/*; do install_file "$u" "/etc/systemd/system/$(basename "$u")" 644 || true; done
  exit 0
fi

say "Packages (Caddy, PostgreSQL 18, Authelia)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q >/dev/null
apt-get install -y -q curl gnupg openssl rsync ca-certificates caddy postgresql-common >/dev/null
[ -f /etc/apt/sources.list.d/pgdg.sources ] || /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh -y >/dev/null
if [ ! -f /etc/apt/sources.list.d/authelia.list ]; then
  curl -fsSL https://www.authelia.com/keys/authelia-security.gpg -o /usr/share/keyrings/authelia-security.gpg
  echo "deb [signed-by=/usr/share/keyrings/authelia-security.gpg] https://apt.authelia.com stable main" >/etc/apt/sources.list.d/authelia.list
  apt-get update -q >/dev/null
fi
apt-get install -y -q postgresql-18 authelia >/dev/null
command -v code-server >/dev/null || echo "!! code-server is not installed: https://coder.com/docs/code-server/install (then re-run)"

say "PostgreSQL 18 (engine database)"
pg_lsclusters -h | grep -q '^18 main' || pg_createcluster 18 main --port 5432 --encoding UTF8 --locale C.UTF-8 >/dev/null
install_file "$HERE/postgres/fundhub.conf" /etc/postgresql/18/main/conf.d/fundhub.conf 644 && systemctl restart postgresql@18-main || true
systemctl enable --now postgresql@18-main >/dev/null
ENGINE_ENV="$REPO/services/engine/.env"
NEW_DB=0
if ! sudo -u postgres psql -tAc "select 1 from pg_roles where rolname='fundhub_engine'" | grep -q 1; then
  PW="$(rand)"
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 -c "create role fundhub_engine login password '$PW'"
  sudo -u postgres psql -q -v ON_ERROR_STOP=1 -c "create database fundhub_engine owner fundhub_engine encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0"
  URL="postgres://fundhub_engine:$PW@127.0.0.1:5432/fundhub_engine"
  for f in "$ENGINE_ENV" "$REPO/packages/engine-db/.env"; do
    touch "$f"; sed -i '/^ENGINE_DATABASE_URL=/d' "$f"; echo "ENGINE_DATABASE_URL=$URL" >>"$f"
  done
  NEW_DB=1
fi

say "Engine secrets"
touch "$ENGINE_ENV" "$REPO/packages/engine-db/.env"
grep -q '^CAPTURE_TOKEN=' "$ENGINE_ENV" || echo "CAPTURE_TOKEN=$(rand)" >>"$ENGINE_ENV"
chown "$APP_USER:" "$ENGINE_ENV" "$REPO/packages/engine-db/.env"; chmod 600 "$ENGINE_ENV" "$REPO/packages/engine-db/.env"

say "Node dependencies and engine schema"
( cd "$REPO" && as_app npm install --no-audit --no-fund >/dev/null )
( cd "$REPO" && as_app npm run -s engine:db:migrate )
[ "$NEW_DB" = 1 ] && ( cd "$REPO" && as_app npm run -s engine:db:seed )

say "Authelia (2FA portal)"
install -d -m 700 -o authelia -g authelia /etc/authelia /etc/authelia/secrets /var/lib/authelia
for s in jwt_secret session_secret storage_encryption_key; do
  f="/etc/authelia/secrets/$s"
  [ -s "$f" ] && continue
  # Migration from a config that still holds the secret inline (the storage key must not change).
  key=$([ "$s" = jwt_secret ] && echo jwt_secret || { [ "$s" = session_secret ] && echo secret || echo encryption_key; })
  old="$(grep -E "^\s*$key:" /etc/authelia/configuration.yml 2>/dev/null | head -1 | sed -E "s/^\s*$key:\s*'?([^']*)'?\s*$/\1/" || true)"
  printf '%s' "${old:-$(rand)}" >"$f"; chown authelia:authelia "$f"; chmod 600 "$f"
done
if [ ! -s /etc/authelia/users.yml ]; then
  PW="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  HASH="$(authelia crypto hash generate argon2 --password "$PW" | sed -n 's/^Digest: //p')"
  printf "users:\n  %s:\n    displayname: '%s'\n    password: '%s'\n    email: '%s@localhost'\n" "$APP_USER" "$APP_USER" "$HASH" "$APP_USER" >/etc/authelia/users.yml
  echo "Authelia login — user: $APP_USER  password: $PW" >/etc/authelia/initial-credentials; chmod 600 /etc/authelia/initial-credentials
  chown authelia:authelia /etc/authelia/users.yml; chmod 600 /etc/authelia/users.yml
  echo "   first login: sudo cat /etc/authelia/initial-credentials"
fi
A=0
install_file "$HERE/authelia/override.conf" /etc/systemd/system/authelia.service.d/override.conf 644 && A=1 || true
install_file "$HERE/authelia/configuration.yml" /etc/authelia/configuration.yml 600 authelia:authelia && A=1 || true
systemctl daemon-reload
sudo -u authelia env AUTHELIA_IDENTITY_VALIDATION_RESET_PASSWORD_JWT_SECRET_FILE=/etc/authelia/secrets/jwt_secret \
  AUTHELIA_SESSION_SECRET_FILE=/etc/authelia/secrets/session_secret AUTHELIA_STORAGE_ENCRYPTION_KEY_FILE=/etc/authelia/secrets/storage_encryption_key \
  authelia validate-config --config /etc/authelia/configuration.yml
systemctl enable authelia >/dev/null
[ "$A" = 1 ] && systemctl restart authelia || systemctl start authelia

say "code-server"
CS="$APP_HOME/.config/code-server/config.yaml"
if [ ! -s "$CS" ]; then
  install -d -o "$APP_USER" -g "$APP_USER" "$(dirname "$CS")"
  sed "s#<generated>#$(rand | cut -c1-24)#" "$HERE/code-server/config.yaml.example" | grep -v '^#' >"$CS"
  chown "$APP_USER:" "$CS"; chmod 600 "$CS"
fi
command -v code-server >/dev/null && systemctl enable --now "code-server@$APP_USER" >/dev/null || true

say "systemd units and scripts"
install_file "$HERE/bin/backup-engine-db.sh" /usr/local/lib/fundhub/backup-engine-db.sh 755 || true
for u in "$HERE"/systemd/*; do install_file "$u" "/etc/systemd/system/$(basename "$u")" 644 || true; done
systemctl daemon-reload
systemctl enable fundhub-capture fundhub-engine-backup.timer fundhub-scraper-jobs.timer fundhub-scraper-weekly.timer >/dev/null 2>&1
systemctl restart fundhub-capture
systemctl start fundhub-engine-backup.timer fundhub-scraper-jobs.timer fundhub-scraper-weekly.timer

say "Drive (FileBrowser Quantum)"
DRIVE_VERSION="v2.0.2-stable"
DRIVE_SHA256="5710dc6f51d77f1db884eace44f6952286c49f2ce40b6a59af37e0dc7c4a8bbd"   # linux-amd64, from the GitHub release
D=0
if ! echo "$DRIVE_SHA256  /usr/local/bin/fundhub-drive" | sha256sum -c - >/dev/null 2>&1; then
  tmp="$(mktemp)"
  curl -fsSL -o "$tmp" "https://github.com/gtsteffaniak/filebrowser/releases/download/$DRIVE_VERSION/linux-amd64-filebrowser"
  echo "$DRIVE_SHA256  $tmp" | sha256sum -c - >/dev/null || { echo "Drive download checksum mismatch, not installed." >&2; rm -f "$tmp"; exit 1; }
  install -m 755 "$tmp" /usr/local/bin/fundhub-drive; rm -f "$tmp"; D=1
fi
id filebrowser >/dev/null 2>&1 || useradd --system --home /var/lib/fundhub-drive --shell /usr/sbin/nologin filebrowser
install -d -o filebrowser -g filebrowser -m 750 /var/lib/fundhub-drive /srv/fundhub-drive
for d in Finance/Receipts Clients Providers Legal Marketing Engine; do install -d -o filebrowser -g filebrowser -m 750 "/srv/fundhub-drive/$d"; done
install -d -m 755 /etc/fundhub-drive
if [ ! -s /etc/fundhub-drive/secrets.env ]; then
  # The JWT secret must never change once the drive has started (it refuses to boot otherwise).
  { echo "FILEBROWSER_ADMIN_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-24)"
    echo "FILEBROWSER_JWT_TOKEN_SECRET=$(rand)"
    echo "FILEBROWSER_TOTP_SECRET=$(openssl rand -hex 16)"; } >/etc/fundhub-drive/secrets.env
fi
chown root:filebrowser /etc/fundhub-drive/secrets.env; chmod 640 /etc/fundhub-drive/secrets.env
if [ ! -f /var/lib/fundhub-drive/filebrowser.sqlite ]; then
  # First start. In proxy mode the admin is the user named in adminUsername, but on an empty database the drive
  # creates that user as a *password* account, which proxy logins then refuse. So: start once with a placeholder
  # admin, create $APP_USER through a local proxy login (as Caddy would after Authelia), then switch to the real file.
  render "$HERE/drive/config.yaml" | sed -E 's/^(\s*adminUsername:).*/\1 "drive-admin"/' >/etc/fundhub-drive/config.yaml
  systemctl restart fundhub-drive
  for _ in $(seq 1 30); do curl -fsS -o /dev/null http://127.0.0.1:8090/drive/ 2>/dev/null && break; sleep 1; done
  curl -sS -o /dev/null -H "Remote-User: $APP_USER" "http://127.0.0.1:8090/drive/api/resources?source=FundHub&path=/" || true
  # New accounts get the folder defaults (no delete); the drive admin gets everything.
  curl -sS -o /dev/null -X PATCH -H "Remote-User: $APP_USER" -H "Content-Type: application/json" \
    "http://127.0.0.1:8090/drive/api/users?username=$APP_USER" \
    -d '{"which":["scopes"],"data":{"scopes":[{"name":"FundHub","scope":"/","permissions":{"view":true,"download":true,"modify":true,"delete":true,"create":true,"configured":true}}]}}' || true
  D=1
fi
install_file "$HERE/drive/config.yaml" /etc/fundhub-drive/config.yaml 644 && D=1 || true
# The archived original FileBrowser (no security fixes) is removed if still present.
rm -rf /usr/local/bin/filebrowser /var/lib/filebrowser /etc/filebrowser
systemctl enable fundhub-drive >/dev/null 2>&1
[ "$D" = 1 ] && systemctl restart fundhub-drive || systemctl start fundhub-drive

say "Caddy (HTTPS, 2FA gate)"
install_file "$HERE/caddy/Caddyfile" /etc/caddy/Caddyfile 644 && { caddy validate --config /etc/caddy/Caddyfile >/dev/null && systemctl reload caddy; } || true
systemctl enable --now caddy >/dev/null

say "Done"
printf '%s\n' "${CHANGED[@]:-(no config files changed)}"
systemctl --no-pager --plain is-active postgresql@18-main authelia caddy fundhub-capture fundhub-drive | paste -sd' '
