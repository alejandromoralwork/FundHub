#!/usr/bin/env bash
# Start / restart / stop the capture receiver (fundhub-capture, 127.0.0.1:4477) that the browser extension talks to.
#   bash infra/vm/bin/capture.sh start|restart|stop|status|logs
# Also wired to code-server: Terminal → Run Task → "Capture server: …", or the ▶ next to `capture:*` in the
# NPM Scripts view (`npm run capture:start`). Uses sudo for systemctl (asks for a password if sudo needs one).
set -uo pipefail
UNIT=fundhub-capture
PORT="${CAPTURE_PORT:-4477}"

# Kind: function. Waits up to 30 s for the receiver to answer on its port (any HTTP status = it is up).
wait_up() {
  for _ in $(seq 1 30); do
    code=$(curl -s -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:$PORT/stats" || true)
    if [ -n "$code" ] && [ "$code" != "000" ]; then
      printf '\033[32mCapture server is up\033[0m on 127.0.0.1:%s — the extension can connect now.\n' "$PORT"; return 0
    fi
    if [ "$(systemctl is-active "$UNIT")" = "failed" ]; then break; fi
    sleep 1
  done
  printf '\033[31mCapture server did not come up.\033[0m Last log lines:\n' >&2
  journalctl -u "$UNIT" -n 30 --no-pager >&2
  return 1
}

case "${1:-start}" in
  start)
    if systemctl is-active --quiet "$UNIT"; then echo "$UNIT is already running."; wait_up; exit $?; fi
    sudo systemctl start "$UNIT" && wait_up ;;
  restart) sudo systemctl restart "$UNIT" && wait_up ;;
  stop)    sudo systemctl stop "$UNIT" && echo "$UNIT stopped." ;;
  status)  systemctl status "$UNIT" --no-pager -n 15 ;;
  logs)    journalctl -u "$UNIT" -f -n 50 ;;
  token)   # The value to paste in the extension (popup → Access token).
    ENV="$(cd "$(dirname "$0")/../../.." && pwd)/services/engine/.env"
    t=$(sed -n 's/^CAPTURE_TOKEN=//p' "$ENV" 2>/dev/null | tr -d '"'"'"' \r')
    [ -n "$t" ] || { echo "No CAPTURE_TOKEN in $ENV (run: sudo bash infra/vm/install.sh)" >&2; exit 1; }
    echo "Paste this in the extension popup → Access token:"; echo; echo "$t" ;;
  *) echo "usage: $0 start|restart|stop|status|logs|token" >&2; exit 2 ;;
esac
