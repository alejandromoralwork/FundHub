#!/bin/sh
# FundHub Scraping Engine container entrypoint.
#   ENGINE_MIGRATE=1  apply engine DB migrations + seed before starting (safe to repeat)
#   ENGINE_VNC=1      start a virtual display with noVNC on :6080 (for `rcs:login` / headed RCS browser)
# Arguments are passed to the engine CLI, e.g. `worker --groups rcs`, `scheduler`, `run cssf_census`.
set -e
cd /app

if [ "$ENGINE_MIGRATE" = "1" ]; then
  node --import tsx packages/engine-db/scripts/migrate.ts
  node --import tsx packages/engine-db/scripts/seed.ts
fi

if [ "$ENGINE_VNC" = "1" ]; then
  export DISPLAY=:99
  Xvfb :99 -screen 0 1366x900x24 >/dev/null 2>&1 &
  sleep 1
  x11vnc -display :99 -forever -shared -nopw -localhost -quiet >/dev/null 2>&1 &
  websockify --web /usr/share/novnc 6080 localhost:5900 >/dev/null 2>&1 &
  echo "noVNC on http://localhost:6080/vnc.html (tunnel it, do not expose it)"
fi

exec node --import tsx services/engine/src/cli.ts "$@"
