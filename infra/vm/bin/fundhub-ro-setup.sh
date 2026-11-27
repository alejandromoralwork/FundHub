#!/usr/bin/env bash
# FILE: infra/vm/bin/fundhub-ro-setup.sh
# WHAT IT DOES: Connects the engine's "fundhub" source (job fundhub_sync) to the WEBSITE database on Neon with its
#   own read-only login, fundhub_engine_ro, without typing hosts or passwords by hand:
#   1. you paste the connection string Neon shows (Connect button) — any role; only its HOST and DATABASE are
#      used, its password is ignored and never stored;
#   2. the script makes a new strong password, writes WEBSITE_DATABASE_URL_RO into services/engine/.env;
#   3. it prints the SQL to paste in Neon's SQL Editor (creates / updates fundhub_engine_ro with that password);
#   4. after you ran it, it tests the connection and says what is wrong, if anything.
# USAGE: bash infra/vm/bin/fundhub-ro-setup.sh            (no sudo needed)
#        bash infra/vm/bin/fundhub-ro-setup.sh --test     only test the current setting
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ENV_FILE="$REPO/services/engine/.env"
ROLE=fundhub_engine_ro

test_connection() {
  local url
  url=$(grep -m1 '^WEBSITE_DATABASE_URL_RO=' "$ENV_FILE" | cut -d= -f2-)
  [ -n "$url" ] || { echo "✗ No WEBSITE_DATABASE_URL_RO in $ENV_FILE"; return 1; }
  echo "Testing the connection…"
  local out
  # psql verifies Neon's certificate against the system's trusted roots (sslrootcert=system), like the engine does.
  if out=$(PGCONNECT_TIMEOUT=15 PGSSLROOTCERT=system psql "$url" -X -At -c "select count(*) from providers" 2>&1); then
    echo "✓ Connected as $ROLE. The website has $out providers. The fundhub source can read them."
    return 0
  fi
  echo "✗ Connection failed: $(echo "$out" | head -1)"
  case "$out" in
    *"password authentication failed"*) echo "  → The SQL was not run in Neon yet, or it ran on another project / branch. Run it (step 3), then: bash $0 --test" ;;
    *"could not translate host"*|*"Name or service not known"*|*"EAI_AGAIN"*) echo "  → The host is wrong. Run this script again and paste the full string from Neon's Connect window." ;;
    *"permission denied"*) echo "  → The role exists but cannot read providers: run the GRANT lines of step 3 again." ;;
    *"root certificate"*|*"certificate verify"*) echo "  → Certificate check problem on this VM (not your Neon settings): tell your developer." ;;
    *"database"*"does not exist"*|*"relation"*"does not exist"*) echo "  → Database or table name differs. Check you picked the right database in Neon's Connect window." ;;
  esac
  return 1
}

if [ "${1:-}" = "--test" ]; then test_connection; exit $?; fi

cat <<'EOF'

Step 1 — In Neon (https://console.neon.tech): open the FundHub project → click "Connect".
         Copy the WHOLE connection string shown there. It looks like:
         postgresql://neondb_owner:npg_xxxx@ep-xxxx-pooler.us-east-1.aws.neon.tech/neondb?sslmode=require
         (Only the host and database name are taken from it. Its password is ignored.)

EOF
read -rsp "Paste the whole connection string here (hidden), then Enter: " CONN; echo

# Take host and database from the pasted string; never keep its password.
HOST=$(printf '%s' "$CONN" | sed -nE 's#^postgres(ql)?://[^@]*@([^/:?]+).*#\2#p')
DB=$(printf '%s' "$CONN" | sed -nE 's#^postgres(ql)?://[^@]*@[^/]+/([^?]+).*#\2#p')
unset CONN
case "$HOST" in
  ep-*.neon.tech) ;;
  *) echo "✗ That does not look like Neon's connection string (no host ep-….neon.tech found). Nothing was changed."; exit 1 ;;
esac
DB=${DB:-neondb}
echo "✓ Host: $HOST"
echo "✓ Database: $DB"

# A new strong password: letters and digits only (safe in a URL).
PW=$(openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c 40)

touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
sed -i '/^WEBSITE_DATABASE_URL_RO=/d' "$ENV_FILE"
echo "WEBSITE_DATABASE_URL_RO=postgres://$ROLE:$PW@$HOST/$DB?sslmode=verify-full" >>"$ENV_FILE"
echo "✓ Saved WEBSITE_DATABASE_URL_RO in services/engine/.env"

cat <<EOF

Step 3 — In Neon: left menu → SQL Editor (same project, same branch, database "$DB").
         Paste these lines and click Run:

---------------------------------------------------------------------------
DO \$\$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '$ROLE') THEN
    ALTER ROLE $ROLE WITH LOGIN PASSWORD '$PW';
  ELSE
    CREATE ROLE $ROLE WITH LOGIN PASSWORD '$PW';
  END IF;
END \$\$;
GRANT USAGE ON SCHEMA public TO $ROLE;
GRANT SELECT ON providers, provider_claims, profile_edits TO $ROLE;
---------------------------------------------------------------------------

(This password exists only here and in services/engine/.env. Do not paste it in a chat.)
EOF
unset PW
read -rp "Press Enter after you clicked Run in Neon… " _
test_connection && {
  echo
  echo "Last step: sudo systemctl restart fundhub-engine-worker"
  echo "Then run once: npm run engine -- run fundhub_sync"
}
