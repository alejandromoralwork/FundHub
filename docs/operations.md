# Operations

Where production runs, how to deploy it, and how to look after it. For the moving parts see [architecture.md](architecture.md).

## 1. Production at a glance

| What | Where | Config |
|---|---|---|
| Website `fundhub.lu` | Vercel project `fund-hub`, root `apps/web` | Vercel env vars |
| Admin `fundhub.lu/admin` | Vercel project `fund-hub-admin`, root `apps/admin`, build `npm run vercel-build` (applies migrations) | Vercel env vars |
| Website DB | Neon Postgres (Vercel Marketplace) | `DATABASE_URL*` per role |
| Data module | Azure VM: `fundhub-scraper-weekly.timer`, `fundhub-scraper-jobs.timer` | VM `services/scraper/.env` |
| Engine, engine DB, Drive, code-server | Azure VM `alejandro-code.centralindia.cloudapp.azure.com` | [infra/vm/](../infra/vm/README.md) |
| Nextcloud, Twenty, Listmonk (optional) | Separate Docker server | [infra/tools/README.md](../infra/tools/README.md) |

Every variable is listed with a comment in [`.env.example`](../.env.example) (website / admin) and [`services/engine/.env.example`](../services/engine/.env.example) (engine).

## 2. Deploying the website and admin

1. **Database.** Add Neon from the Vercel Marketplace and connect it to both projects. Run `npm run db:migrate`, then create the per-part roles:
   `DATABASE_URL=<owner url> WEB_DB_PASSWORD=… ADMIN_DB_PASSWORD=… SCRAPER_DB_PASSWORD=… ANALYST_DB_PASSWORD=… npm run db:roles -w @fundhub/db`. Re-run it after migrations that add tables.
2. **Website** (`fund-hub`): `DATABASE_URL` (fundhub_web role), `ADMIN_ORIGIN` (admin deployment URL), optional `RESEND_API_KEY`, `EMAIL_FROM`, `LISTMONK_URL`, `LISTMONK_LIST_UUID`.
3. **Admin** (`fund-hub-admin`): `DATABASE_URL` (fundhub_admin), `DATABASE_URL_UNPOOLED`, `ANALYST_DATABASE_URL`, `PUBLIC_SITE_URL`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, Stripe keys, price ids and `STRIPE_WEBHOOK_SECRET`, `POSTHOG_URL`, `ENGINE_DATABASE_URL` (Company intelligence pages: the `fundhub_console` connection string from `~/.fundhub-secrets/engine-console-db-url` on the VM, created by `sudo bash infra/vm/bin/engine-db-remote-access.sh`; needs the Azure NSG rule for TCP 5432), and the sidebar tools `DRIVE_URL`, `CODE_SERVER_URL`, `NEXTCLOUD_URL`, `TWENTY_URL`, `LISTMONK_URL`, `POSTIZ_URL`.
4. **Intelligence pipeline (VM):** `services/engine/.env` with `ENGINE_DATABASE_URL`, `ANTHROPIC_API_KEY` (company-website source; a separate key from the admin's), `WEBSITE_DATABASE_URL_RO` (fundhub_engine_ro role) and `WEBSITE_DATABASE_URL_PUBLISH` (fundhub_scraper role), then `sudo bash infra/vm/install.sh` to start `fundhub-engine-worker` and `fundhub-engine-scheduler` ([docs/data-pipeline.md](data-pipeline.md)).
5. **First staff owner:** `npm run staff -w @fundhub/admin -- create <email> "<name>" owner` against the production database.

Deploys happen on push to `main` (Vercel). Migrations run in the admin build.

## 3. The Azure VM

Ubuntu 24.04, Standard D2as v5 (2 vCPU, 8 GB RAM; resized in place from B2als v2 for Metabase), public DNS `alejandro-code.centralindia.cloudapp.azure.com`. Only ports 22, 80 and 443 are open; everything else listens on `127.0.0.1` behind Caddy.

| URL path | Service | systemd unit |
|---|---|---|
| `/authelia` | 2FA login portal (password + authenticator code) | `authelia` |
| `/` | code-server (VS Code in the browser), behind Authelia 2FA | code-server |
| `/engine/*` | Capture receiver for the extension (Bearer token) | `fundhub-capture` |
| `/drive/*` | Internal drive, FileBrowser Quantum, behind Authelia 2FA (see 4) | `fundhub-drive` |
| `/bi/*` | Data intelligence (Metabase): editor behind Authelia 2FA + Metabase login; signed embeds public ([data-intelligence.md](data-intelligence.md)) | `fundhub-metabase` |
| — | PostgreSQL 18: `fundhub_engine` (Intelligence DB), `metabase` (Data intelligence app data) | `postgresql` |
| — | Intelligence pipeline worker and cron scheduler | `fundhub-engine-worker`, `fundhub-engine-scheduler` |
| — | Nightly DB backup (`fundhub_engine`, `metabase`), 03:30 UTC | `fundhub-engine-backup.timer` |

Day-to-day commands, restore, importing a database and moving to a data disk: [infra/vm/README.md](../infra/vm/README.md). Extension setup (URL + token): [browser-extension/README.md](../services/engine/browser-extension/README.md).

**After pulling new code on the VM:** `npm install`, `npm run engine:db:migrate` if the engine schema changed, `sudo systemctl restart fundhub-capture`.

## 4. Drive

The admin's **Drive** page (`/admin/drive`, all staff roles) has an **Open Drive** button, and the sidebar a **Drive** link; both open the drive's shared `FundHub` folder in a new tab (`…/drive/files/FundHub/`). The address is `DRIVE_URL`, or the VM's drive when it is not set (`apps/admin/src/lib/drive.ts`).

| | |
|---|---|
| Software | [FileBrowser Quantum](https://github.com/gtsteffaniak/filebrowser) (Apache-2.0), version and SHA-256 pinned in `infra/vm/install.sh` → `/usr/local/bin/fundhub-drive` |
| Address | `https://<vm>/drive/` (service `fundhub-drive`, `127.0.0.1:8090`) |
| Files | `/srv/fundhub-drive`: `Finance/Receipts`, `Clients`, `Providers`, `Legal`, `Marketing`, `Engine` |
| Config | `infra/vm/drive/config.yaml` → `/etc/fundhub-drive/config.yaml` |
| Secrets | `/etc/fundhub-drive/secrets.env` (root only): JWT key, TOTP key, bootstrap admin password |
| Admin setting | Optional: `DRIVE_URL=https://<vm>/drive` on the admin project (defaults to the VM) |

**Login.** The drive sits behind the same Authelia 2FA as code-server: one VM login (password + authenticator code) for both. Caddy strips any `Remote-User` header a visitor sends, Authelia sets the real one, and the drive trusts it (FileBrowser Quantum *proxy* login). The drive has **no password of its own**, and it listens on `127.0.0.1` only. It is not embedded in the admin because browsers block the 2FA cookie inside another site's frame.

**Accounts.** Every Authelia user who opens the drive gets a drive account automatically, with the folder defaults from `drive/config.yaml`: view, download, upload/create and edit; **no delete**. Grant delete, or narrow access to some folders, in *Settings → Users*. Being drive admin does not by itself allow uploads: the per-folder rights above decide that. The user named in `adminUsername` (the VM user, `alejandro`) is the drive admin. To add a person: add them to `/etc/authelia/users.yml` (password hash), they register their authenticator, then open the drive.

**Never change** `FILEBROWSER_JWT_TOKEN_SECRET` in `secrets.env` after the first start: the drive refuses to boot when it differs from the key stored in its database. (`FILEBROWSER_ADMIN_PASSWORD` there is only used for the first-start bootstrap and is not a login.)

It cannot run on Vercel: a drive needs a server with a permanent disk.

## 5. Backups

| Data | Backup | Restore |
|---|---|---|
| Website DB | Neon point-in-time restore | Neon console |
| Engine DB + Metabase DB | `pg_dump` nightly → `/var/backups/fundhub-engine`, 14 days, verified with `pg_restore --list`; optional off-VM copy with rclone (`RCLONE_REMOTE`) | [deploy/README.md](../infra/vm/README.md#restore-a-backup) |
| Engine files (captures, PDFs) on the data disk `/srv/fundhub-data` | Azure snapshot of the disk, and/or the nightly off-VM copy of new PDFs (`RCLONE_DOCS_REMOTE`, never pruned) | [infra/vm/README.md → Data disk](../infra/vm/README.md#data-disk-for-filing-pdfs) |
| Drive files (`/srv/fundhub-drive`) | none yet — add an off-VM copy before storing real documents | — |
| Self-hosted tools | `infra/tools/backup.sh` nightly | [infra/tools/README.md](../infra/tools/README.md) |

Backups on the same disk as the data are not enough: configure the off-VM copy.

## 6. Secrets

| Secret | Lives in | Rotate by |
|---|---|---|
| Database role passwords | Vercel env, GitHub secrets | `npm run db:roles` with new passwords, update env |
| `CAPTURE_TOKEN` | VM `services/engine/.env` | Edit, `sudo systemctl restart fundhub-capture`, paste in the extension popup |
| Engine DB password | VM `services/engine/.env`, `packages/engine-db/.env` | `ALTER ROLE fundhub_engine PASSWORD …`, update both files, restart |
| Stripe, Resend, Anthropic, GitHub tokens | Vercel / GitHub | Provider dashboard, then env |
| Authelia login (VM 2FA) | `/etc/authelia/users.yml` (hash only). On a new install the first password is in `/etc/authelia/initial-credentials`, deleted by the first password change | `sudo bash infra/vm/bin/authelia-passwd.sh` ([access-and-recovery.md §3](access-and-recovery.md#3-vm-login-authelia-2fa)) |
| Drive keys | VM `/etc/fundhub-drive/secrets.env` (root only) | Do not rotate the JWT key (the drive would refuse to start); logins use Authelia |
