#!/usr/bin/env bash
# FundHub VM health check: what is down, why, and the command that usually fixes it.
#   sudo bash infra/vm/bin/health.sh
# Read-only: it changes nothing. Run it first whenever something on the VM does not answer.
set -uo pipefail
[ "$(id -u)" = 0 ] || { echo "Run with sudo (it reads logs and secret-file permissions)." >&2; exit 1; }
DOMAIN="${DOMAIN:-alejandro-code.centralindia.cloudapp.azure.com}"
APP_USER="${APP_USER:-$(stat -c %U "$(cd "$(dirname "$0")/../../.." && pwd)")}"
PROBLEMS=0
ok()   { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       fix: %s\n' "$2"; PROBLEMS=$((PROBLEMS+1)); }
warn() { printf '  \033[33mWARN\033[0m %s\n' "$1"; [ -n "${2:-}" ] && printf '       hint: %s\n' "$2"; }
lastlog() { journalctl -u "$1" -n 40 --no-pager 2>/dev/null | grep -E "level=(error|fatal)|FATAL|ERROR|error|denied|failed" | tail -2 | sed 's/^/       log: /'; }

echo "== Services"
for u in caddy authelia "code-server@$APP_USER" postgresql@18-main fundhub-capture fundhub-engine-worker fundhub-engine-scheduler fundhub-drive; do
  if systemctl is-active --quiet "$u"; then ok "$u running"
  else bad "$u is $(systemctl is-active "$u")" "sudo systemctl restart $u; journalctl -u $u -n 50 --no-pager"; lastlog "$u"; fi
done
for t in fundhub-engine-backup.timer; do
  systemctl is-active --quiet "$t" && ok "$t scheduled" || bad "$t not scheduled" "sudo systemctl enable --now $t"
done
for s in fundhub-engine-backup; do
  [ "$(systemctl show -p Result --value "$s")" = "success" ] || warn "$s: last run result $(systemctl show -p Result --value "$s")" "journalctl -u $s -n 50 --no-pager"
done

echo "== Local ports (only 22/80/443 should be public)"
for p in 80:caddy 443:caddy 9091:authelia 8080:code-server 5432:postgres 4477:capture 8090:drive; do
  ss -ltn | awk '{print $4}' | grep -qE "[:.]${p%%:*}$" && ok "port ${p%%:*} (${p#*:}) listening" || bad "nothing listens on ${p%%:*} (${p#*:})" "see that service above"
done

echo "== Secrets readable by their services (the 2026-11-19 outage)"
for f in jwt_secret session_secret storage_encryption_key; do
  sudo -u authelia test -r "/etc/authelia-secrets/$f" && ok "authelia reads /etc/authelia-secrets/$f" \
    || bad "authelia cannot read /etc/authelia-secrets/$f" "sudo chown -R authelia:authelia /etc/authelia-secrets && sudo chmod 700 /etc/authelia-secrets && sudo chmod 600 /etc/authelia-secrets/* && sudo systemctl restart authelia"
done
sudo -u filebrowser test -r /etc/fundhub-drive/secrets.env && ok "drive reads its secrets.env" || bad "drive cannot read /etc/fundhub-drive/secrets.env" "sudo chown root:filebrowser /etc/fundhub-drive/secrets.env && sudo chmod 640 /etc/fundhub-drive/secrets.env"
[ -f /etc/authelia/initial-credentials ] && warn "first Authelia password still on disk" "save it in your password manager, then: sudo rm /etc/authelia/initial-credentials"

echo "== Public endpoints (https://$DOMAIN)"
code() { curl -sS -o /dev/null -m 10 -w '%{http_code}' "https://$DOMAIN$1" 2>/dev/null || echo 000; }
c=$(code /authelia/); [ "$c" = 200 ] && ok "/authelia/ login page ($c)" || bad "/authelia/ answers $c" "authelia down or Caddy broken: check both above; caddy validate --config /etc/caddy/Caddyfile"
c=$(code /);          [ "$c" = 302 ] && ok "/ code-server requires login ($c)" || bad "/ answers $c (expected 302 to the login)" "Caddyfile or Authelia: sudo bash infra/vm/install.sh --diff"
c=$(code /drive/);    [ "$c" = 302 ] && ok "/drive/ requires login ($c)" || bad "/drive/ answers $c (expected 302)" "Caddyfile or Authelia"
c=$(code /engine/stats); [ "$c" = 401 ] && ok "/engine requires the token ($c)" || bad "/engine/stats answers $c (expected 401)" "fundhub-capture down (502) or token check broken"
exp=$(echo | timeout 10 openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$exp" ]; then
  days=$(( ($(date -d "$exp" +%s) - $(date +%s)) / 86400 ))
  [ "$days" -gt 14 ] && ok "HTTPS certificate valid $days more days" || warn "HTTPS certificate expires in $days days" "Caddy renews it itself: journalctl -u caddy | grep -i acme"
else bad "could not read the HTTPS certificate" "journalctl -u caddy -n 50"; fi

echo "== Machine"
disk=$(df --output=pcent / | tail -1 | tr -dc 0-9); [ "$disk" -lt 85 ] && ok "disk ${disk}% used" || bad "disk ${disk}% used" "sudo du -xh / --max-depth=2 | sort -h | tail; old backups: /var/backups/fundhub-engine"
avail=$(free -m | awk '/^Mem:/{print $7}'); [ "$avail" -gt 300 ] && ok "memory: ${avail} MB available" || warn "memory low: ${avail} MB available" "close editor tabs / restart code-server@$APP_USER"
last=$(ls -t /var/backups/fundhub-engine/*.dump 2>/dev/null | head -1)
if [ -n "$last" ] && [ "$(find "$last" -mmin -1560)" ]; then ok "latest DB backup: $(basename "$last")"; else warn "no engine DB backup in the last 26 h" "sudo systemctl start fundhub-engine-backup; journalctl -u fundhub-engine-backup -n 30"; fi
up=$(uptime -s); ok "up since $up"

echo
[ "$PROBLEMS" = 0 ] && echo "All checks passed." || echo "$PROBLEMS problem(s). Full guide: docs/troubleshooting.md"
exit $(( PROBLEMS > 0 ))
