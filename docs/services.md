# Services and modules

One entry per part of FundHub: what it does, where it runs, how to operate it, where its settings, data and logs are. For how they fit together see [architecture.md](architecture.md); for adding people and getting access back see [access-and-recovery.md](access-and-recovery.md).

**Quick map**

| # | Part | Kind | Runs on | Address |
|---|---|---|---|---|
| 1 | [Website](#1-website-appsweb) | Next.js app | Vercel | https://fundhub.lu |
| 2 | [Admin console](#2-admin-console-appsadmin) | Next.js app | Vercel | https://fundhub.lu/admin |
| 3 | [Website database](#3-website-database-neon) | Postgres | Neon | private |
| 4 | [Scraping engine](#4-scraping-engine-servicesengine) | Node CLI / workers | Azure VM | — |
| 5 | [Capture receiver](#5-capture-receiver-fundhub-capture) | Node HTTP service | Azure VM | `https://<vm>/engine/` |
| 6 | [LBR capture extension](#6-lbr-capture-extension) | Chrome extension | staff PCs | — |
| 7 | [Engine database](#7-engine-database-postgresql-18) | Postgres 18 | Azure VM | `127.0.0.1:5432` |
| 8 | [Data module](#8-data-module-servicesscraper) | Node CLI on timers | Azure VM | — |
| 9 | [Caddy](#9-caddy-https-and-routing) | Web server | Azure VM | ports 80/443 |
| 10 | [Authelia](#10-authelia-vm-2fa-login) | 2FA login portal | Azure VM | `https://<vm>/authelia/` |
| 11 | [code-server](#11-code-server) | VS Code in the browser | Azure VM | `https://<vm>/` |
| 12 | [Drive](#12-drive-filebrowser-quantum) | File manager | Azure VM | `https://<vm>/drive/` |
| 13 | [Backups](#13-backups-fundhub-engine-backup) | Timer + script | Azure VM | — |
| 14 | [Shared packages](#14-shared-packages-packages) | TypeScript libraries | — | — |
| 15 | [Self-hosted tools](#15-self-hosted-tools-infratools) | Docker (optional) | separate server | `drive.` / `crm.` / `newsletter.fundhub.lu` |
| 16 | [Marketing pack](#16-marketing-pack-marketing) | LaTeX + Python | your PC | — |

`<vm>` = `alejandro-code.centralindia.cloudapp.azure.com`. Every VM service below is defined in [`infra/vm/`](../infra/vm/README.md) and installed by `sudo bash infra/vm/install.sh`.

---

## 1. Website (`apps/web`)

The public face of FundHub: provider search and filters, profiles, compare, FundHub Score, benchmarks, awards, reviews, company claims, RFIs, Data Intelligence reports and membership, advisory, news and learn, legal pages and GDPR requests, an AI advisor widget.

| | |
|---|---|
| Runs on | Vercel project `fund-hub` (root `apps/web`); deploys on push to `main` |
| Local | `npm run dev:web` → http://localhost:3000 (needs the website DB, `npm run db:local`) |
| Database role | `fundhub_web`: cannot read staff, audit, email, billing, finance or ingest tables |
| Accounts | Visitors sign up at `/account/signup`; providers claim a company, staff approve |
| Settings | `DATABASE_URL`, `ADMIN_ORIGIN`, `RESEND_API_KEY`, `EMAIL_FROM`, `LISTMONK_*` (see `.env.example`) |
| Logs | Vercel → project → *Logs* |

## 2. Admin console (`apps/admin`)

Where staff run the business. Modules (left menu):

| Module | What it does | Roles |
|---|---|---|
| Dashboard | Totals and recent activity | all |
| Moderation | Company claims, client reviews, provider self-edits: approve / reject | owner, operations |
| Inbox | Every form submission (RFIs, contact, advisory): status, notes, email replies, "Send to CRM" | owner, operations, sales |
| Email | Write to a person or a segment; delivery log from Resend | owner, operations, sales |
| Content studio | News and Learn articles, AI drafts (facts only), social media versions | owner, operations, sales |
| Billing & invoices | Stripe customers, Pro subscriptions, advisory invoices, reminders | owner, sales |
| Finance | P&L, expenses, Luxembourg VAT, budgets, CSV for the accountant | owner |
| Analytics | Traffic and conversion figures | all |
| Data pipeline | Data module runs and jobs, **Run scrape**, field-by-field review of scraped changes | owner, operations, analyst |
| Scraping engine | Overview, Registry, Jobs & schedules, Match review, Capture rounds | view: owner, operations, analyst; edit: owner, operations |
| Drive | **Open Drive** button; also a sidebar link (module 12) | all |
| Reports | Upload Data Intelligence PDFs, visibility | owner, operations |
| Database | Browse and edit every table; read-only SQL console | browse: all; edit: owner, operations; SQL: owner, analyst |
| GDPR requests | Data export and erasure, deadlines | owner, operations |
| Staff | Add staff, change roles, deactivate, reset password / 2FA | owner |
| Audit log | Every staff write, who and when | owner, operations, analyst |
| Account | Your own password and authenticator | all |

Sidebar links: Code editor (owners), Nextcloud, CRM, newsletter, social scheduler when configured.

| | |
|---|---|
| Runs on | Vercel project `fund-hub-admin` (root `apps/admin`, build `npm run vercel-build`, which applies migrations); mounted at `fundhub.lu/admin` through the website |
| Local | `npm run dev:admin` → http://localhost:3001/admin |
| Login | Staff accounts only: password + mandatory authenticator code; after a new account or a password reset the person must choose their own password (`/admin/login/new-password`); roles in `apps/admin/src/lib/auth.ts` (`CAN`); terminal recovery: [access-and-recovery.md §1.1](access-and-recovery.md#11-reset-an-admin-password-from-the-terminal-locked-out-no-email) |
| Settings | DB URLs, Stripe, Resend, `ENGINE_DATABASE_URL`, `DRIVE_URL`, `CODE_SERVER_URL`, tool URLs (see `.env.example`) |
| Logs | Vercel → project → *Logs*; staff actions in the **Audit log** module |

## 3. Website database (Neon)

Postgres holding everything the website and the business run on: providers, accounts, reviews, claims, RFIs, reports, staff, audit log, email log, billing, finance, GDPR, and the `ingest_*` review queue. Schema: `packages/db/src/schema.ts`; migrations: `packages/db/drizzle/`.

| | |
|---|---|
| Where | Neon (via the Vercel Marketplace), region `us-east-1` (move to the EU: [architecture.md → gaps](architecture.md#6-known-gaps-and-next-steps)) |
| Roles | `fundhub_web`, `fundhub_admin`, `fundhub_scraper`, `fundhub_analyst_ro` (`npm run db:roles -w @fundhub/db`) |
| Local copy | `npm run db:local` (port 5433, data in `packages/db/.pg-data`) |
| Backup | Neon point-in-time restore |

## 4. Scraping engine (`services/engine`)

Builds one registry of every Luxembourg entity from CSSF, GLEIF and the RCS/LBR register, with the full history of every change. Pipeline: fetch → store raw bytes → parse → diff → history → match to an entity → golden record → classification. Details: [services/engine/README.md](../services/engine/README.md).

| | |
|---|---|
| Runs on | Azure VM, from the repo checkout |
| Commands | `npm run engine -- <command>`: `status`, `entity B145917`, `run cssf_census`, `run gleif_sync`, `round:*`, `sweep:*`, `worker`, `scheduler` |
| Settings | `services/engine/.env` (`ENGINE_DATABASE_URL`, `CAPTURE_TOKEN`, storage), template `services/engine/.env.example` |
| Data | Engine database (module 7); raw pages and PDFs under `STORAGE_ROOT` (`/srv/fundhub-data/engine/blobs` once the data disk is set up, else `services/engine/.engine-data/blobs`) |
| Tests | `npm test -w @fundhub/engine` |

## 5. Capture receiver (`fundhub-capture`)

The engine's HTTP service that the Chrome extension talks to: receives LBR pages and PDFs, serves the work list, capture rounds and the search sweep.

| | |
|---|---|
| Address | `https://<vm>/engine/*` → `127.0.0.1:4477`; every request needs `Authorization: Bearer <CAPTURE_TOKEN>` (no 2FA: it is a machine client) |
| Operate | code-server: *Terminal → Run Task → Capture server: start / restart / stop / logs*, or `npm run capture:start` / `capture:restart`; logs `journalctl -u fundhub-capture -f` |
| Token | `npm run capture:token` (reads `services/engine/.env`) |
| Captures | Also saved as gzip JSON files in `CAPTURES_DIR` (`/srv/fundhub-data/engine/captures` with the data disk, else `services/engine/.engine-data/captures/`); `npm run engine -- rcs:import-captures` re-imports them (`.json` and `.json.gz`) |
| Documents | Filing PDFs only for the document scope (`DOCUMENT_SCOPE`, default `cssf`: CSSF entities that are not funds); see [data-pipeline.md → Filing documents](data-pipeline.md#filing-documents-pdfs) |

## 6. LBR capture extension

Chrome extension "FundHub LBR Capture" (`services/engine/browser-extension`). Saves the LBR pages and filing PDFs **a person** opens (LBR blocks robots), guides capture rounds and the search sweep. Full guide: [browser-extension/README.md](../services/engine/browser-extension/README.md).

| | |
|---|---|
| Install | `chrome://extensions` → Developer mode → Load unpacked → the folder |
| Connect | Popup → setup screen: Engine address `https://<vm>/engine` (default), Access token = `npm run capture:token` on the VM → *Connect* |
| Update | Replace the folder, then ↻ Reload on its card |

## 7. Engine database (PostgreSQL 18)

The staging database of the data pipeline: entities, identifiers, names, relations, source records, captures, observations (history), filings, documents, change events, rounds, sweep words. Schema: `packages/engine-db/src/schema.ts`.

| | |
|---|---|
| Where | Azure VM, `postgresql@18-main`, `127.0.0.1:5432` only; database and role `fundhub_engine` |
| Connect | `sudo -u postgres psql fundhub_engine` |
| Migrate | `npm run engine:db:migrate` (from the repo root) |
| Config | `infra/vm/postgres/fundhub.conf` (memory sized for the 4 GB VM) |
| Backup | Module 13 |

## 8. Data module (`services/scraper`)

AI extraction of provider websites (Claude, strict schema) into the website DB's review queue (`ingest_*`); staff approve in **Data pipeline**. Its RCS source is a mock.

| | |
|---|---|
| Runs on | Azure VM: `fundhub-scraper-jobs.timer` (jobs queued by **Run scrape**, every 5 min), `fundhub-scraper-weekly.timer` (all providers, Mondays 03:00 UTC) |
| Settings | `services/scraper/.env` (`DATABASE_URL` with the `fundhub_scraper` role, `ANTHROPIC_API_KEY`); the timers skip until it exists |
| Operate | `sudo systemctl start fundhub-scraper-jobs` (run now); `journalctl -u fundhub-scraper-jobs -u fundhub-scraper-weekly -n 50`; `systemctl list-timers 'fundhub-*'` |
| By hand | `npm run scrape -- run --source ai_web --provider <slug> --dry-run` |

## 9. Caddy (HTTPS and routing)

The only thing listening on the internet (ports 80/443). Gets the HTTPS certificate automatically and routes:

| Path | Goes to | Protection |
|---|---|---|
| `/authelia*` | Authelia | it is the login page |
| `/engine/*` | Capture receiver | Bearer token |
| `/drive*` | Drive | Authelia 2FA |
| everything else | code-server | Authelia 2FA |

Config: `infra/vm/caddy/Caddyfile` → `/etc/caddy/Caddyfile`. Check: `caddy validate --config /etc/caddy/Caddyfile`; apply: `sudo systemctl reload caddy`; logs: `journalctl -u caddy`.

## 10. Authelia (VM 2FA login)

One login (password + authenticator code) for everything a browser opens on the VM: the Drive (any VM user) and code-server (group `admins` only). Blocks a user for 30 min after 3 wrong tries in 5 min. Sessions last 12 h (2 h idle).

| | |
|---|---|
| Config | `infra/vm/authelia/configuration.yml` → `/etc/authelia/`; secrets in `/etc/authelia-secrets/`; users in `/etc/authelia/users.yml` |
| Operate | `sudo systemctl restart authelia`; `journalctl -u authelia -f` |
| Users, passwords, lost phone, bans | [access-and-recovery.md → Authelia](access-and-recovery.md#3-vm-login-authelia-2fa) |

## 11. code-server

VS Code in the browser, running as the VM user, with a terminal on the VM (effectively root: the user has sudo). Behind Authelia 2FA **for the `admins` group only**, plus its own password as a second lock.

| | |
|---|---|
| Service | `code-server@alejandro` (`127.0.0.1:8080`) |
| Config | `~/.config/code-server/config.yaml` (template `infra/vm/code-server/config.yaml.example`) |
| Admin link | Sidebar *Code editor (VM)*, owners only (`CODE_SERVER_URL`) |

## 12. Drive (FileBrowser Quantum)

FundHub's internal files: `Finance/Receipts`, `Clients`, `Providers`, `Legal`, `Marketing`, `Engine`. Opened from the admin's **Drive** page. Same Authelia login as code-server; the drive has no password of its own. Details: [operations.md → Drive](operations.md#4-drive).

| | |
|---|---|
| Service | `fundhub-drive` (`127.0.0.1:8090`), binary `/usr/local/bin/fundhub-drive` (version + SHA-256 pinned in `install.sh`) |
| Files | `/srv/fundhub-drive` |
| Config | `infra/vm/drive/config.yaml` → `/etc/fundhub-drive/config.yaml`; keys in `/etc/fundhub-drive/secrets.env` |
| Operate | `sudo systemctl restart fundhub-drive`; `journalctl -u fundhub-drive -f` |
| Backup | **None yet** — add an off-VM copy before storing real documents |

## 13. Backups (`fundhub-engine-backup`)

Nightly at 03:30 UTC: `pg_dump` of the engine DB to `/var/backups/fundhub-engine/`, checked readable, 14 days kept; optional off-VM copy with rclone (`RCLONE_REMOTE` in `/etc/default/fundhub-backup`, pruned after 14 days). Engine files (PDFs, raw pages, captures): set `RCLONE_FILES_REMOTE` (and `FILES_DIR` if not `/srv/fundhub-data/engine`) for a separate copy that only adds new files and is never pruned.

Run now: `sudo systemctl start fundhub-engine-backup`; list: `sudo ls -lh /var/backups/fundhub-engine`; restore: [infra/vm/README.md → Restore](../infra/vm/README.md#restore-a-backup).

## 14. Shared packages (`packages/`)

| Package | What |
|---|---|
| `@fundhub/core` | Service taxonomy, enums, filters, FundHub Score, awards, formatting, password rules, company identity |
| `@fundhub/db` | Website DB schema, migrations, client, shared queries, role setup, provider import/publish pipelines |
| `@fundhub/engine-db` | Engine DB schema, migrations, client, and engine logic shared with the admin (entities, golden record, rounds, sweep) |
| `@fundhub/email` | Email templates (React Email) and the Resend sender; without a key, mails print to the console |

## 15. Self-hosted tools (`infra/tools`)

Optional Docker server with **Nextcloud** (drive, calendar, task boards), **Twenty** (CRM, used by Inbox "Send to CRM") and **Listmonk** (newsletter). Not installed yet. Guide: [infra/tools/README.md](../infra/tools/README.md).

## 16. Marketing pack (`marketing/`)

LaTeX sources for the business presentation, the client brochure and the provider flyer, diagrams drawn in Python, screenshots. Guide: [marketing/README.md](../marketing/README.md).
