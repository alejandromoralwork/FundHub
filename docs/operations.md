# Operations

Where production runs, how to deploy it, and how to look after it. For the moving parts see [architecture.md](architecture.md).

## 1. Production at a glance

| What | Where | Config |
|---|---|---|
| Website `fundhub.lu` | Vercel project `fund-hub`, root `apps/web` | Vercel env vars |
| Admin `fundhub.lu/admin` | Vercel project `fund-hub-admin`, root `apps/admin`, build `npm run vercel-build` (applies migrations) | Vercel env vars |
| Website DB | Neon Postgres (Vercel Marketplace) | `DATABASE_URL*` per role |
| Data module | GitHub Actions `.github/workflows/scrape.yml` | Repo secrets |
| Engine, engine DB, Drive, code-server | Azure VM `alejandro-code.centralindia.cloudapp.azure.com` | [services/engine/deploy/](../services/engine/deploy/README.md) |
| Nextcloud, Twenty, Listmonk (optional) | Separate Docker server | [infra/README.md](../infra/README.md) |

Every variable is listed with a comment in [`.env.example`](../.env.example) (website / admin) and [`services/engine/.env.example`](../services/engine/.env.example) (engine).

## 2. Deploying the website and admin

1. **Database.** Add Neon from the Vercel Marketplace and connect it to both projects. Run `npm run db:migrate`, then create the per-part roles:
   `DATABASE_URL=<owner url> WEB_DB_PASSWORD=… ADMIN_DB_PASSWORD=… SCRAPER_DB_PASSWORD=… ANALYST_DB_PASSWORD=… npm run db:roles -w @fundhub/db`. Re-run it after migrations that add tables.
2. **Website** (`fund-hub`): `DATABASE_URL` (fundhub_web role), `ADMIN_ORIGIN` (admin deployment URL), optional `RESEND_API_KEY`, `EMAIL_FROM`, `LISTMONK_URL`, `LISTMONK_LIST_UUID`.
3. **Admin** (`fund-hub-admin`): `DATABASE_URL` (fundhub_admin), `DATABASE_URL_UNPOOLED`, `ANALYST_DATABASE_URL`, `PUBLIC_SITE_URL`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, Stripe keys, price ids and `STRIPE_WEBHOOK_SECRET`, optional `GITHUB_DISPATCH_TOKEN` + `GITHUB_REPO`, `POSTHOG_URL`, `ENGINE_DATABASE_URL` (engine pages), and the sidebar tools `DRIVE_URL`, `CODE_SERVER_URL`, `NEXTCLOUD_URL`, `TWENTY_URL`, `LISTMONK_URL`, `POSTIZ_URL`.
4. **Data module:** GitHub secrets `SCRAPER_DATABASE_URL` (fundhub_scraper) and `ANTHROPIC_API_KEY`; optional variable `RCS_SOURCE`.
5. **First staff owner:** `npm run staff -w @fundhub/admin -- create <email> "<name>" owner` against the production database.

Deploys happen on push to `main` (Vercel). Migrations run in the admin build.

## 3. The Azure VM

Ubuntu 24.04, Standard B2als v2 (2 vCPU, 4 GB RAM), public DNS `alejandro-code.centralindia.cloudapp.azure.com`. Only ports 22, 80 and 443 are open; everything else listens on `127.0.0.1` behind Caddy.

| URL path | Service | systemd unit |
|---|---|---|
| `/` | code-server (VS Code in the browser, own password) | code-server |
| `/engine/*` | Capture receiver for the extension (Bearer token) | `fundhub-capture` |
| `/drive/*` | Internal drive (see 4) | `fundhub-drive` |
| — | PostgreSQL 18, `fundhub_engine` | `postgresql` |
| — | Nightly engine DB backup, 03:30 UTC | `fundhub-engine-backup.timer` |

Day-to-day commands, restore, importing a database and moving to a data disk: [services/engine/deploy/README.md](../services/engine/deploy/README.md). Extension setup (URL + token): [browser-extension/README.md](../services/engine/browser-extension/README.md).

**After pulling new code on the VM:** `npm install`, `npm run engine:db:migrate` if the engine schema changed, `sudo systemctl restart fundhub-capture`.

## 4. Drive

The admin's **Drive** page (`/admin/drive`, all staff roles) shows FundHub's internal file drive inside the console, with an *Open in new tab* button. It embeds whatever `DRIVE_URL` points to; without it the page shows setup help.

The drive itself is a self-hosted open-source file manager on the VM, served at `https://<vm>/drive/`, files in `/srv/fundhub-drive` (folders `Finance/Receipts`, `Clients`, `Providers`, `Legal`, `Marketing`, `Engine`), its own user accounts and per-folder permissions. It cannot run on Vercel: a drive needs a server with a permanent disk.

**Status:** the original FileBrowser project was archived on 2026-09-01 (no more security fixes), so it is installed but **not enabled or exposed**. The maintained successor, FileBrowser Quantum (`gtsteffaniak/filebrowser`), is the planned replacement. To finish:

1. Install the chosen drive binary as `/usr/local/bin/filebrowser`, listening on `127.0.0.1:8090` with base URL `/drive` and root `/srv/fundhub-drive`.
2. `sudo systemctl enable --now fundhub-drive` (unit in `services/engine/deploy/fundhub-drive.service`).
3. Add to `/etc/caddy/Caddyfile`, inside the site block, and `sudo systemctl reload caddy`:

   ```caddy
   handle /drive/* {
       header Content-Security-Policy "frame-ancestors 'self' https://fundhub.lu https://*.vercel.app http://localhost:3001"
       header -X-Frame-Options
       reverse_proxy 127.0.0.1:8090
   }
   ```
4. Set `DRIVE_URL=https://<vm>/drive` on the admin project.

Inside a frame some browsers block the drive's sign-in cookie; *Open in new tab* always works.

## 5. Backups

| Data | Backup | Restore |
|---|---|---|
| Website DB | Neon point-in-time restore | Neon console |
| Engine DB | `pg_dump` nightly → `/var/backups/fundhub-engine`, 14 days, verified with `pg_restore --list`; optional off-VM copy with rclone (`RCLONE_REMOTE`) | [deploy/README.md](../services/engine/deploy/README.md#restore-a-backup) |
| Engine files (captures, PDFs) | none yet — move to object storage | — |
| Drive files | none yet — add before real use | — |
| Self-hosted tools | `infra/backup.sh` nightly | [infra/README.md](../infra/README.md) |

Backups on the same disk as the data are not enough: configure the off-VM copy.

## 6. Secrets

| Secret | Lives in | Rotate by |
|---|---|---|
| Database role passwords | Vercel env, GitHub secrets | `npm run db:roles` with new passwords, update env |
| `CAPTURE_TOKEN` | VM `services/engine/.env` | Edit, `sudo systemctl restart fundhub-capture`, paste in the extension popup |
| Engine DB password | VM `services/engine/.env`, `packages/engine-db/.env` | `ALTER ROLE fundhub_engine PASSWORD …`, update both files, restart |
| Stripe, Resend, Anthropic, GitHub tokens | Vercel / GitHub | Provider dashboard, then env |
| Drive admin password | VM `/etc/filebrowser/admin-credentials` (root only) | In the drive's settings |
