# Codebase guide

A map of the repository: what every folder holds, the conventions used everywhere, and how to make the common kinds of change. The *why* behind the layout is in [architecture.md](architecture.md).

## 1. Monorepo layout

One npm workspace (`package.json` → `workspaces`), built with Turborepo (`turbo.json`). TypeScript everywhere, Node.js 20.9+.

```
FundHub/
├── apps/
│   ├── web/                 @fundhub/web    public website (Next.js, App Router)
│   └── admin/               @fundhub/admin  staff console (Next.js + Refine + Ant Design), basePath /admin
├── services/
│   ├── engine/              @fundhub/engine   scraping engine: CLI, workers, capture receiver
│   │   ├── browser-extension/                 Chrome extension "FundHub LBR Capture"
│   │   ├── docs/                              LBR findings, data-reuse request
│   │   └── snippets/                          legacy DevTools snippet (replaced by the extension)
│   └── scraper/             @fundhub/scraper  data module: AI web extraction (VM timers)
├── packages/
│   ├── core/                @fundhub/core       taxonomy, enums, filters, score, formatting, passwords
│   ├── db/                  @fundhub/db         website DB: schema, migrations, client, queries, roles
│   ├── engine-db/           @fundhub/engine-db  engine DB: schema, migrations, client, shared engine logic
│   └── email/               @fundhub/email      React Email templates + Resend sender
├── infra/
│   ├── vm/                  Azure VM: every config outside the repo + install.sh (Caddy, Authelia, Postgres, systemd)
│   └── tools/               optional Docker server: Nextcloud, Twenty, Listmonk
├── marketing/               LaTeX presentation, brochures, diagrams (Python), screenshots
├── scripts/                 repo tools (check-comments-only.mjs)
└── docs/                    this documentation
```

Dependency direction: `apps/*` and `services/*` import `packages/*`; packages never import apps or services; apps and services never import each other.

## 2. Workspaces in detail

### `apps/web` — public website

| Path | What |
|---|---|
| `src/app/` | Routes. Main pages: `/` home, `/providers/[slug]` (+ `/review`), `/services/[category]`, `/compare`, `/benchmarks`, `/awards`, `/fundhub-score`, `/methodology`, `/independence`, `/news`, `/learn`, `/data-intelligence` (+ membership, reports), `/advisory` (+ fund-setup), `/for-providers`, `/rfi`, `/account/*` (login, signup, profiles), `/legal/[page]`, `/privacy-request` |
| `src/app/api/` | JSON endpoints: `providers`, `stats`, `health`, `advisor` (AI advisor widget) |
| `src/components/` | UI pieces: `app-shell`, `filter-bar` / `filter-pane`, `claim-form`, `auth-form`, `advisor-widget`, `cookie-consent`, `gdpr-form`… |
| `src/lib/` | Server actions (`*-actions.ts`: accounts, reviews, saved providers, requests, GDPR, membership), visitor auth (`auth/`), newsletter (Listmonk), report PDFs, site URL |
| `src/content/` | Legal texts and built-in report definitions |

### `apps/admin` — staff console

| Path | What |
|---|---|
| `src/app/(console)/` | One folder per page: `claims`, `reviews`, `edits`, `requests` (inbox), `email`, `content`, `billing`, `finance`, `analytics`, `pipeline`, `engine/*` (overview, registry, jobs, matches, rounds), `drive`, `reports`, `db/*` (+ SQL console), `gdpr`, `staff`, `audit`, `account` |
| `src/app/login/` | Password, 2FA (TOTP), forgot / reset by email, forced new password after a reset (`new-password`) |
| `src/app/api/` | Generic resource API for Refine (`resources/[resource]`), webhooks (`stripe`, `resend`) |
| `src/components/` | Screens (`*-view(s).tsx`), `console-shell.tsx` (sidebar menu, tool links) |
| `src/lib/` | `auth.ts` (sessions, 2FA, **`CAN` permission table**), server actions per area (`*-actions.ts`), `audit.ts`, Stripe, CRM (Twenty), GitHub dispatch, metrics, engine data access (`engine-*.ts`) |
| `scripts/staff.ts` | CLI: create staff, reset password / 2FA, list; prints which database and role it uses ([access-and-recovery.md §1.1](access-and-recovery.md#11-reset-an-admin-password-from-the-terminal-locked-out-no-email)) |

### `services/engine` — scraping engine

| Path | What |
|---|---|
| `src/cli.ts` | Entry point for every command (`npm run engine -- <command>`); see its header for the list |
| `src/capture-server.ts` | HTTP receiver for the extension: captures, documents, work list, rounds, sweep |
| `src/core/` | The pipeline: `ingest.ts` (the heart), `diff.ts`, `resolve.ts` (entity matching), `golden.ts`, `classify.ts`, `normalize.ts`, `media.ts`, `types.ts` (`SourceAdapter`, `ParsedRecord`) |
| `src/sources/<name>/` | One folder per source: `cssf`, `gleif`, `rcs` (browser + parser), `lbr-bulk` (search-list rows) |
| `src/jobs/` | Queue jobs (pg-boss) and their registry (`index.ts`) |
| `src/queue.ts`, `src/storage.ts`, `src/config.ts` | Queue, blob storage (fs / S3), all settings from env |
| `test/` | Node's built-in test runner (`node --test`): parsers on real fixtures, core rules, rounds, sweep, DB integration |

### `services/scraper` — data module

`src/sources/ai-web.ts` (Claude extraction with a strict schema), `src/crawl.ts`, `src/runner.ts`, `src/store.ts` (writes `ingest_*`), `src/sources/rcs.ts` (mock client).

### `packages/*`

| Package | Key files |
|---|---|
| `core` | `taxonomy.ts` (service categories), `enums.ts`, `filters.ts`, `score.ts` (FundHub Score), `awards.ts`, `format.ts`, `password*.ts`, `company.ts` (legal identity — fill in before launch) |
| `db` | `src/schema.ts`, `src/client.ts`, `src/queries.ts`, `drizzle/` (migrations), `scripts/` (`local-postgres`, `migrate`, `seed`, `roles`, `pipelines/import-providers`, `pipelines/publish-staged`), `data/` (sample providers and posts — fictional) |
| `engine-db` | `src/schema.ts`, `src/client.ts`, `src/core/` (entity, golden, classify, registry (RCS existence), document-scope (which PDFs are kept), rounds, sweep — shared by engine and admin), `src/seed-data.ts`, `drizzle/` |
| `email` | `src/templates/`, `src/send.ts` (Resend; without a key, mails print to the console and are still logged) |

## 3. Conventions

* **File headers.** Every source file starts with a block: `FILE`, `PART`, `WHAT IT DOES`, `WHERE IT RUNS`, and often `FRAMEWORK NOTES` / `TYPESCRIPT YOU WILL SEE HERE`. Functions carry `Kind:` comments. Keep this when adding files: it is how the codebase documents itself.
* **Comment-only changes** can be checked with `node scripts/check-comments-only.mjs <files…>` (fails if code changed).
* **Database access** goes through Drizzle (`@fundhub/db/client`, `@fundhub/engine-db/client`). Schema changes are made in `schema.ts`, then a migration is generated; never edit the database by hand.
* **Server actions** (`*-actions.ts`) do every write from the UI. In the admin they check the role with `requireStaff(CAN.x)` and record the change with `audit.ts`.
* **Secrets** come only from environment variables (`.env.example` lists them all); `.env*` files are never committed.
* **Next.js version.** The apps use a recent Next.js with breaking changes; read `node_modules/next/dist/docs/` before changing framework-level code (see `apps/admin/AGENTS.md`).

## 4. Common changes, step by step

**Add an admin page**
1. Create `apps/admin/src/app/(console)/<name>/page.tsx`; start it with `await requireStaff(CAN.<permission>)`.
2. Add a permission to `CAN` in `src/lib/auth.ts` if none fits.
3. Add a menu entry in `RESOURCES` in `src/components/console-shell.tsx`.
4. Put writes in a `src/lib/<area>-actions.ts` server action that calls the audit log.

**Change the website DB schema**
1. Edit `packages/db/src/schema.ts`.
2. `npm run db:generate` (creates a migration in `packages/db/drizzle/`), then `npm run db:migrate`.
3. New table? Re-run `npm run db:roles -w @fundhub/db` in production and decide which roles may see it (`ADMIN_ONLY_TABLES`, `WEB_READ_ONLY_TABLES` in `scripts/roles.ts`).

**Change the engine DB schema:** the same with `npm run engine:db:generate` / `engine:db:migrate`. On the VM, run the migrate, then `sudo systemctl restart fundhub-capture`.

**Add an engine source:** a folder in `services/engine/src/sources/` implementing `SourceAdapter` (`fetch` + a pure `parse`), jobs in `src/jobs/index.ts`, a fixture and parser test in `test/`.

**Add an environment variable:** read it in code, document it in `.env.example` (or `services/engine/.env.example`), set it in Vercel / GitHub / the VM.

## 5. Checks

```bash
npm run typecheck                  # every workspace
npm test -w @fundhub/engine        # engine (DB tests run when the engine DB is reachable)
npm test -w @fundhub/scraper
npm run build                      # both Next.js apps
```
