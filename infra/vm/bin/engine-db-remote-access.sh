#!/usr/bin/env bash
# FILE: infra/vm/bin/engine-db-remote-access.sh
# WHAT IT DOES: Lets the admin console on Vercel reach the Intelligence DB (PostgreSQL on this VM), securely:
#   - a dedicated login `fundhub_console`: random 48-char password, SCRAM-SHA-256, connection limit, read/write
#     on the pipeline's data but no schema changes (the owner `fundhub_engine` stays local-only);
#   - remote connections ONLY over TLS, ONLY for that user, ONLY to database fundhub_engine; everything else from
#     outside the VM is rejected before authentication (pg_hba "reject");
#   - TLS with the domain's real Let's Encrypt certificate (copied from Caddy; daily cron keeps it renewed), so
#     clients verify the server (sslmode=verify-full);
#   - auth_delay (1 s after every failed login), connection + failed-auth logging.
#   The connection string is written to ~/.fundhub-secrets/engine-console-db-url (mode 600), never printed.
# USAGE: sudo bash infra/vm/bin/engine-db-remote-access.sh            set up / re-apply (keeps the password)
#        sudo bash infra/vm/bin/engine-db-remote-access.sh --rotate   new password (update Vercel afterwards)
#        sudo bash infra/vm/bin/engine-db-remote-access.sh --cert     refresh the TLS certificate only (cron)
#        sudo bash infra/vm/bin/engine-db-remote-access.sh --off      close remote access again
# ALSO NEEDED: an inbound rule for TCP 5432 in the VM's Azure Network Security Group (portal → VM → Networking).
set -euo pipefail

PGV=18
PGDIR=/etc/postgresql/$PGV/main
DB=fundhub_engine
OWNER=fundhub_engine
ROLE=fundhub_console
DOMAIN=${DOMAIN:-$(awk 'NF && $1 !~ /^#/ && /\{/ {print $1; exit}' /etc/caddy/Caddyfile)}
APP_USER=${APP_USER:-${SUDO_USER:-alejandro}}
SECRETS_DIR=$(getent passwd "$APP_USER" | cut -d: -f6)/.fundhub-secrets
URL_FILE=$SECRETS_DIR/engine-console-db-url
CONF=$PGDIR/conf.d/zz-fundhub-remote.conf   # "zz": loaded after fundhub.conf, which sets listen_addresses = localhost
TLS_DIR=$PGDIR/tls
HBA=$PGDIR/pg_hba.conf
MARK_BEGIN="# >>> fundhub remote access (engine-db-remote-access.sh)"
MARK_END="# <<< fundhub remote access"
SCHEMAS=(raw staging clean match core ops mart)

[ "$(id -u)" = 0 ] || { echo "Run with sudo." >&2; exit 1; }
psql_db() { sudo -u postgres psql -v ON_ERROR_STOP=1 -qAt -d "$DB" "$@"; }

install_cert() {
  local src=/var/lib/caddy/.local/share/caddy/certificates/acme-v02.api.letsencrypt.org-directory/$DOMAIN
  [ -f "$src/$DOMAIN.crt" ] || { echo "No Caddy certificate for $DOMAIN in $src" >&2; exit 1; }
  install -d -o postgres -g postgres -m 700 "$TLS_DIR"
  if ! cmp -s "$src/$DOMAIN.crt" "$TLS_DIR/server.crt" || ! cmp -s "$src/$DOMAIN.key" "$TLS_DIR/server.key"; then
    install -o postgres -g postgres -m 644 "$src/$DOMAIN.crt" "$TLS_DIR/server.crt"
    install -o postgres -g postgres -m 600 "$src/$DOMAIN.key" "$TLS_DIR/server.key"
    systemctl reload "postgresql@$PGV-main" 2>/dev/null || true
    echo "TLS certificate installed for $DOMAIN"
  fi
}

case "${1:-}" in
  --cert) install_cert; exit 0 ;;
  --off)
    rm -f "$CONF" /etc/cron.daily/fundhub-pg-cert
    sed -i "/$MARK_BEGIN/,/$MARK_END/d" "$HBA"
    systemctl restart "postgresql@$PGV-main"
    echo "Remote access closed (Postgres listens on localhost only). Remove the Azure NSG rule for 5432 too."
    exit 0 ;;
esac

echo "== TLS certificate"
install_cert
cat >/etc/cron.daily/fundhub-pg-cert <<EOF
#!/bin/sh
# Copies Caddy's renewed Let's Encrypt certificate to PostgreSQL (engine-db-remote-access.sh --cert).
exec bash $(readlink -f "$0") --cert >/dev/null
EOF
chmod 755 /etc/cron.daily/fundhub-pg-cert

echo "== PostgreSQL settings ($CONF)"
cat >"$CONF" <<EOF
# Remote access for the admin console on Vercel (infra/vm/bin/engine-db-remote-access.sh). TLS only; see pg_hba.conf.
listen_addresses = '*'
ssl = on
ssl_cert_file = '$TLS_DIR/server.crt'
ssl_key_file = '$TLS_DIR/server.key'
ssl_min_protocol_version = 'TLSv1.2'
password_encryption = 'scram-sha-256'
# Slow down password guessing: 1 s pause after every failed authentication.
shared_preload_libraries = 'auth_delay'
auth_delay.milliseconds = 1000
log_connections = on
log_disconnections = off
EOF

echo "== pg_hba.conf"
sed -i "/$MARK_BEGIN/,/$MARK_END/d" "$HBA"
cat >>"$HBA" <<EOF
$MARK_BEGIN
# Only the console login, only this database, only encrypted. Anything else from outside is rejected.
hostssl $DB $ROLE 0.0.0.0/0 scram-sha-256
hostssl $DB $ROLE ::/0      scram-sha-256
host    all all   0.0.0.0/0 reject
host    all all   ::/0      reject
$MARK_END
EOF

echo "== Restart PostgreSQL"
systemctl restart "postgresql@$PGV-main"

echo "== Login $ROLE"
exists=$(sudo -u postgres psql -qAt -c "select 1 from pg_roles where rolname = '$ROLE'")
if [ -z "$exists" ] || [ "${1:-}" = "--rotate" ] || [ ! -s "$URL_FILE" ]; then
  PW=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 48)
  [ -n "$exists" ] && verb=ALTER || verb=CREATE
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "$verb ROLE $ROLE LOGIN PASSWORD '$PW' CONNECTION LIMIT 30 NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT"
  install -d -o "$APP_USER" -g "$APP_USER" -m 700 "$SECRETS_DIR"
  umask 077
  echo "postgres://$ROLE:$PW@$DOMAIN:5432/$DB?sslmode=verify-full" >"$URL_FILE"
  chown "$APP_USER:$APP_USER" "$URL_FILE"; chmod 600 "$URL_FILE"
  unset PW
  echo "Password set; connection string written to $URL_FILE"
fi

# Vercel functions freeze with their connections open: the server closes console sessions idle for 60 s, and the
# limit is applied on every run (also to an existing role).
psql_db -c "ALTER ROLE $ROLE CONNECTION LIMIT 30"
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -c "ALTER ROLE $ROLE SET idle_session_timeout = '60s'"

echo "== Privileges"
grants="GRANT CONNECT ON DATABASE $DB TO $ROLE;"
schemas=("${SCHEMAS[@]}")
# The job queue (pg-boss) exists once an engine worker has started; the console queues jobs there.
[ -n "$(psql_db -c "select 1 from pg_namespace where nspname = 'pgboss'")" ] && schemas+=(pgboss) || echo "(schema pgboss not created yet: start the engine worker once, then re-run this script)"
for s in "${schemas[@]}"; do
  grants+="
GRANT USAGE ON SCHEMA $s TO $ROLE;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA $s TO $ROLE;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA $s TO $ROLE;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER IN SCHEMA $s GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO $ROLE;
ALTER DEFAULT PRIVILEGES FOR ROLE $OWNER IN SCHEMA $s GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO $ROLE;"
done
# pg-boss creates one table per new queue, and functions it calls: allow that in its own schema only.
[[ " ${schemas[*]} " == *" pgboss "* ]] && grants+="
GRANT CREATE ON SCHEMA pgboss TO $ROLE;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss TO $ROLE;"
psql_db -c "$grants"

echo
echo "Done. Postgres accepts $ROLE over TLS on $DOMAIN:5432 (everything else from outside is rejected)."
echo "Next: 1) Azure NSG inbound rule TCP 5432;  2) Vercel → fund-hub-admin → ENGINE_DATABASE_URL = contents of $URL_FILE"
