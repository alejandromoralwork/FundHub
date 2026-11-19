# Architecture

How FundHub is put together: the parts, where each runs, which data each holds, and how data moves between them. Read this first; [codebase.md](codebase.md) then maps it onto folders and files.

## 1. The system in one picture

```
                         VISITORS / FUND MANAGERS / PROVIDERS                         STAFF
                                       │                                               │
                                       ▼                                               ▼
┌──────────────────────────── Vercel ───────────────────────────────────────────────────────────────┐
│  apps/web   fundhub.lu  (Next.js)  ──rewrites /admin/*──▶  apps/admin  fundhub.lu/admin (Next.js) │
│  public site, accounts, reviews,                            console: moderation, inbox, billing,  │
│  claims, RFI, reports, advisor                              finance, content, GDPR, pipeline,     │
│                                                             engine pages, Drive, staff, audit     │
└───────────────┬──────────────────────────────────────────────────┬─────────────────┬──────────────┘
                │ role fundhub_web                                 │ fundhub_admin   │ ENGINE_DATABASE_URL
                ▼                                                  ▼                 │
        ┌────────────────────── WEBSITE DB (Neon Postgres) ──────────────┐           │
        │ published providers, users, reviews, claims, RFIs, reports,    │           │
        │ + internal: staff, audit, email log, billing, finance, GDPR,   │           │
        │ + ingest_* staging (review queue for scraped changes)          │           │
        └───────────────▲────────────────────────────────────────────────┘           │
                        │ role fundhub_scraper (ingest_* only)                       │
        ┌───────────────┴───────────┐                                                │
        │ services/scraper          │  on the Azure VM (systemd timers): weekly AI   │
        │ (data module)             │  web extraction, queued jobs every 5 min       │
        └───────────────────────────┘                                                │
                                                                                     ▼
┌──────────────────────────── Azure VM  (Ubuntu 24.04, Caddy HTTPS on :443) ─────────────────────────┐
│  /engine/*  ─▶ capture-server :4477 ──┐                                                            │
│                (Bearer token)         ├─▶ ENGINE DB  PostgreSQL 18 :5432 (localhost only)          │
│  services/engine CLI / worker ────────┘     registry, history, filings, rounds, sweep              │
│  /drive/*   ─▶ internal drive (file manager)          /var/backups ◀─ nightly pg_dump              │
│  /          ─▶ code-server (VS Code in the browser), behind Authelia 2FA (/authelia)              │
│  timers     ─▶ services/scraper (data module) ──▶ website DB (ingest_* only)                       │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ HTTPS
        │
  Staff Chrome + "FundHub LBR Capture" extension, browsing lbr.lu with their own login

  Optional, separate server (infra/tools/): Nextcloud · Twenty CRM · Listmonk newsletter (linked from the admin sidebar)
```

## 2. The parts

| Part | Folder | Runs on | Job |
|---|---|---|---|
| **Website** | `apps/web` | Vercel (`fund-hub` project) | Public comparator of Luxembourg fund service providers: search, compare, profiles, FundHub Score, reviews, claims, RFIs, Data Intelligence reports, advisory, legal/GDPR pages, AI advisor widget |
| **Admin console** | `apps/admin` | Vercel (`fund-hub-admin`), mounted at `fundhub.lu/admin` | Everything staff do: moderation, inbox, email, content studio, billing (Stripe), finance, analytics, data pipeline review, scraping-engine pages, Drive, reports, DB browser, GDPR, staff, audit |
| **Data module** | `services/scraper` | Azure VM, systemd timers (weekly + every 5 min for queued jobs) | AI extraction of provider websites into the review queue (`ingest_*`). Its RCS source is a mock |
| **Scraping engine** | `services/engine` | Azure VM (or Docker anywhere) | Builds one registry of every Luxembourg entity from CSSF, GLEIF and RCS/LBR, with full history |
| **LBR capture extension** | `services/engine/browser-extension` | Staff Chrome | Saves the LBR pages and filing PDFs a person opens into the engine (LBR blocks automated browsing) |
| **Shared code** | `packages/core`, `packages/db`, `packages/engine-db`, `packages/email` | Imported by the above | Taxonomy and rules, the two database schemas and clients, email templates |
| **VM setup** | `infra/vm` | Azure VM (`install.sh`) | Every config the VM runs outside the repo: Caddy, Authelia 2FA, PostgreSQL, systemd units, backups |
| **Self-hosted tools** | `infra/tools` | Separate Docker server (planned) | Nextcloud, Twenty CRM, Listmonk |
| **Marketing pack** | `marketing/` | LaTeX, locally | Presentation, brochures, diagrams |

Each part deploys and fails on its own. They share only code (`packages/*`) and databases, never call each other's internals.

## 3. Data stores

FundHub keeps **two databases on purpose**:

| | Website DB | Engine DB |
|---|---|---|
| Purpose | What the business **serves and runs on**: published data, accounts, and internal operations | **Staging** of the data pipeline: raw facts from registers, their history, unreviewed |
| Engine | Neon Postgres (serverless) | PostgreSQL 18 on the Azure VM (`fundhub_engine`) |
| Schema | `packages/db/src/schema.ts` (Drizzle) | `packages/engine-db/src/schema.ts` (Drizzle) |
| Who connects | website (`fundhub_web`), admin (`fundhub_admin`), scraper (`fundhub_scraper`), SQL console (`fundhub_analyst_ro`) | engine processes, capture receiver, admin engine pages |
| Backups | Neon point-in-time restore | nightly `pg_dump` on the VM (`infra/vm/`) |
| Size driver | small | grows with the LBR scrape; PDFs live outside it |

**Website DB tables, by area** (31 tables):

| Area | Tables |
|---|---|
| Public catalogue | `providers`, `reviews`, `posts`, `reports`, `report_downloads` |
| Visitor accounts | `users`, `sessions`, `password_resets`, `saved_providers`, `provider_claims`, `profile_edits`, `rfi_requests`, `rate_limits` |
| Staff and audit | `staff_users`, `staff_sessions`, `staff_password_resets`, `audit_log` |
| Money | `billing_customers`, `subscriptions`, `invoices`, `expenses`, `budgets` |
| Communication | `email_messages`, `social_posts` |
| Data pipeline staging | `ingest_runs`, `ingest_jobs`, `ingest_records` |
| Compliance | `gdpr_requests` |

**Engine DB tables** (24): the registry (`entities`, `entity_identifiers`, `entity_names`, `entity_relations`, `activity_categories`, `classification_rules`), what each source said (`source_records`, `captures`, `observations`, `cssf_details`, `rcs_filings`, `documents`), change tracking (`change_events`, `row_history`, `match_candidates`), and operations (`crawl_runs`, `source_cursors`, `census_snapshots`, `rcs_number_space`, `capture_rounds`, `capture_round_items`, `lbr_search_words`, `engine_settings`, `session_health`).

**Files** live outside the databases:

| Files | Where |
|---|---|
| Raw captures and filing PDFs (engine) | Object storage, addressed by SHA-256 (`docs/<sha256>.pdf`). Driver `fs` (folder on the VM) today, `s3` (R2 / MinIO / AWS) when it grows |
| Uploaded report PDFs | Website DB (`reports`) |
| Internal business documents | The Drive on the VM (`/srv/fundhub-drive`) |

## 4. How data moves

### 4.1 Provider data: from the web to a public profile

```
provider website ──▶ services/scraper (Claude, strict JSON schema) ──▶ ingest_records (website DB)
                                                                            │  staff review field by field
                                                                            ▼  /admin/pipeline
                                                                       providers (published)
```

Scraped values that already match the live profile are dropped, so only real changes reach review. Page content is treated as untrusted data.

### 4.2 Register data: the scraping engine

```
CSSF API ─┐                                  ┌─▶ object storage (raw bytes)
GLEIF API ├─▶ adapter.fetch ─▶ raw capture ──┤
LBR pages ┘   (extension → capture-server)   └─▶ adapter.parse ─▶ core/ingest.ts
                                                     unchanged? touch last_seen
                                                     changed?  capture → diff → change_events
                                                               → observations (history per attribute)
                                                               → resolve entity (RCS → LEI → CSSF code → name)
                                                               → golden record + classification + tier
```

The LBR register cannot be browsed by robots (every search runs a Friendly Captcha), so a person browses it and the extension copies what they open. Details: [services/engine/README.md](../services/engine/README.md), [browser-extension/README.md](../services/engine/browser-extension/README.md), [services/engine/docs/lbr-findings.md](../services/engine/docs/lbr-findings.md).

### 4.3 From the engine to the website (not built yet)

The intended path is one-way: an engine job writes proposals into the website's `ingest_*` tables with the `fundhub_scraper` role, and staff approve them in `/admin/pipeline` like any scraped change. The website never reads the engine DB. Today only the admin console reads both.

## 5. Security model

| Concern | How it is handled |
|---|---|
| Database least privilege | One Postgres role per part (`packages/db/scripts/roles.ts`). `fundhub_web` cannot read staff, audit, email, billing, finance or ingest tables; `fundhub_scraper` writes only `ingest_*` |
| Staff login | Separate `staff_users`, password + mandatory TOTP 2FA, roles `owner` / `operations` / `analyst` / `sales`; permissions in `CAN` (`apps/admin/src/lib/auth.ts`); every staff write goes to `audit_log` |
| Visitor login | Own `users` / `sessions`, rate-limited (`rate_limits`) |
| Admin exposure | `X-Frame-Options: DENY`, `noindex`; only reachable through login |
| VM access | SSH by key only; every browser path except `/engine/*` requires an Authelia session (password + TOTP, lockout after 3 failures) |
| Engine on the VM | Postgres and the receiver listen on `127.0.0.1` only; Caddy terminates HTTPS; the receiver requires `Authorization: Bearer <CAPTURE_TOKEN>` and refuses proxied requests without a configured token |
| Secrets | `.env*` files are git-ignored; production values live in Vercel and the VM's `.env` files (mode 600) |
| Untrusted content | Scraped pages and LBR captures are data, never instructions; the AI extractor uses a strict schema |
| Personal data | RCS filings name directors: record the GDPR basis and a retention period; GDPR export/erasure flows in the admin |

## 6. Known gaps and next steps

In order of importance:

1. **Data location.** The website DB is in Neon `us-east-1` and the VM in Azure Central India. FundHub handles EU personal data (directors, accounts): move both to an EU region (Frankfurt / West Europe).
2. **Engine → website promoter** (4.3) is missing; engine data reaches the site only by hand.
3. **Engine files** are on the VM disk. Move them to S3-compatible storage (`STORAGE_DRIVER=s3`) and put the database on a separate Azure data disk ([infra/vm/README.md](../infra/vm/README.md)).
4. **Two scrapers.** Fold `services/scraper`'s AI extraction into the engine's planned web agent and retire the mock RCS source.
5. **Internal data separation.** Finance, CRM, staff and audit tables share the website DB, separated by roles. Next step: move them to an `internal` schema the `fundhub_web` role cannot reach; a separate database later if needed.
6. **Dev and prod on one VM.** The engine runs from the development checkout. Later, run it from a fixed release (the existing `services/engine/Dockerfile`).
