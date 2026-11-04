# FundHub Scraping Engine — one image for every role (worker, RCS worker, scheduler, CLI).
# Build from the REPO ROOT:  docker build -f services/engine/Dockerfile -t fundhub-engine .
# Runs anywhere Docker runs: laptop, Azure VM, any cloud. Configuration is env only (see README.md).

# Playwright's image ships Chromium + its system libraries; keep the tag equal to the `playwright` npm version.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

# Xvfb + x11vnc + noVNC: lets a person complete the LuxTrust login in a browser tab on a headless VM
# (ENGINE_VNC=1, port 6080, reach it through an SSH tunnel — never expose it publicly).
RUN apt-get update \
 && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify tini \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_BROWSERS_PATH=/ms-playwright PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install only the engine's workspaces (the website/admin apps are not needed here).
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/engine-db/package.json packages/engine-db/
COPY services/engine/package.json services/engine/
RUN npm ci --include=dev -w @fundhub/core -w @fundhub/engine-db -w @fundhub/engine --include-workspace-root=false

COPY packages/core packages/core
COPY packages/engine-db packages/engine-db
COPY services/engine services/engine
RUN chmod +x services/engine/docker-entrypoint.sh

# Data written by the fs storage driver and the RCS browser profile live in /data (mount a volume).
ENV STORAGE_ROOT=/data/blobs RCS_PROFILE_DIR=/data/rcs-profile
VOLUME ["/data"]

ENTRYPOINT ["/usr/bin/tini", "--", "/app/services/engine/docker-entrypoint.sh"]
CMD ["worker"]
