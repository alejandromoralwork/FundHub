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
        │ + ingest_* (Publish review queue: proposals from the pipeline) │           │
        └───────────────▲──────────────────────────┬─────────────────────┘           │
   role fundhub_scraper │ (publish: ingest_* only)  │ role fundhub_engine_ro          │
                        │                           │ (FundHub accounts source)       │
                        └──────── Intelligence pipeline (Azure VM) ◀──┘               ▼
┌──────────────────────────── Azure VM  (Ubuntu 24.04, Caddy HTTPS on :443) ─────────────────────────┐
│  /engine/*  ─▶ capture-server :4477 ──┐                                                            │
│                (Bearer token)         ├─▶ INTELLIGENCE DB  PostgreSQL 18 :5432 (localhost only)    │
│  services/engine worker + scheduler ──┘     schemas raw · staging · clean · match · core · mart · ops│
│  /drive/*   ─▶ internal drive (file manager)          /var/backups ◀─ nightly pg_dump              │
│  /bi/*      ─▶ Metabase :3010 (Data intelligence; reads both DBs read-only; embeds in /admin)      │
│  /          ─▶ code-server (VS Code in the browser), behind Authelia 2FA (/authelia)              │
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
| **Intelligence pipeline** ("engine") | `services/engine` | Azure VM: `fundhub-engine-worker` + `fundhub-engine-scheduler` (or Docker anywhere) | The most complete database of Luxembourg companies: LBR, GLEIF, CSSF, FundHub accounts, company websites (AI extraction — the former `services/scraper`) and news, through raw → staging → approval gate → clean → match → golden records, with full history; publishes proposals to the website. See [data-pipeline.md](data-pipeline.md) |
| **Data intelligence** | Metabase (`infra/bi`, `infra/vm/bin/metabase-install.sh`) | Azure VM (`fundhub-metabase`, `/bi`) | Query manager, system reports (versioned in `infra/bi/reports`) and team reports over both databases, read-only; dashboards embedded in the admin at `/admin/intelligence`. See [data-intelligence.md](data-intelligence.md) |
| **LBR capture extension** | `services/engine/browser-extension` | Staff Chrome | Saves the LBR pages and filing PDFs a person opens into the engine (LBR blocks automated browsing) |
| **Shared code** | `packages/core`, `packages/db`, `packages/engine-db`, `packages/email` | Imported by the above | Taxonomy and rules, the two database schemas and clients, email templates |
| **VM setup** | `infra/vm` | Azure VM (`install.sh`) | Every config the VM runs outside the repo: Caddy, Authelia 2FA, PostgreSQL, systemd units, backups |
| **Self-hosted tools** | `infra/tools` | Separate Docker server (planned) | Nextcloud, Twenty CRM, Listmonk |
| **Marketing pack** | `marketing/` | LaTeX, locally | Presentation, brochures, diagrams |

Each part deploys and fails on its own. They share only code (`packages/*`) and databases, never call each other's internals.

## 3. Data stores

FundHub keeps **two databases on purpose**:

| | Website DB | Intelligence DB ("engine DB") |
|---|---|---|
| Purpose | What the business **serves and runs on**: published data, accounts, and internal operations | The **data pipeline**: every source's raw content, cleaned facts with history, matching, golden company records |
| Engine | Neon Postgres (serverless) | PostgreSQL 18 on the Azure VM (`fundhub_engine`) |
| Schema | `packages/db/src/schema.ts` (Drizzle) | `packages/engine-db/src/schema/*.ts` (Drizzle, one Postgres schema per layer) |
| Who connects | website (`fundhub_web`), admin (`fundhub_admin`), pipeline publish (`fundhub_scraper`), pipeline FundHub source (`fundhub_engine_ro`, read-only), SQL console (`fundhub_analyst_ro`) | engine processes, capture receiver, admin Company intelligence pages |
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
| Publish review (proposals from the pipeline) | `ingest_runs`, `ingest_jobs` (retired), `ingest_records` |
| Compliance | `gdpr_requests` |

**Intelligence DB** (48 tables + 14 views), one Postgres schema per pipeline layer: `raw` (fetches, documents), `staging` (source_records, parsed_records + approval gate), `clean` (claims, rejects, licences, filings, web_pages, articles), `match` (candidates, conflicts), `core` (companies with their fund profile, identifiers, names, relations, company groups + members, services offered, service mandates + evidence (incl. domiciliation by address), fund events, people, positions, web_presence, news_mentions, review_summaries, field_lineage, changes, row_history, categories, rules), `mart` (views) and `ops` (sources, attribute_precedence, review_policies, runs, quality, census, LBR tooling, news feeds). Table by table: [data-pipeline.md](data-pipeline.md).

**Files** live outside the databases:

| Files | Where |
|---|---|
| Raw captures and filing PDFs (engine) | Object storage, addressed by SHA-256 (`docs/<sha256>.pdf`). Driver `fs` (folder on the VM) today, `s3` (R2 / MinIO / AWS) when it grows |
| Uploaded report PDFs | Website DB (`reports`) |
| Internal business documents | The Drive on the VM (`/srv/fundhub-drive`) |

## 4. How data moves

### 4.1 One pipeline for every source

```
LBR · GLEIF · CSSF · FundHub accounts · company websites · news   (LinkedIn, Glassdoor, Instagram, Facebook, X: phase 2)
   │ acquire
   ▼
 raw ──▶ staging ──◇ approval gate ──▶ clean ──▶ match ──▶ core (golden) ──▶ publish ──▶ ingest_records ──▶ providers
 bytes    parsed    (per-source       validate   resolve +   precedence,      proposals    staff accept field by field
 kept     versions   review policy)   normalize  cross-check lineage          (one-way)    in /admin/pipeline
```

Every source goes through the same stages (`services/engine/src/pipeline/`). Unchanged content stops at staging; a source's review policy may hold a version for a person; cleaned values become claims with history; matching links records to one company per real legal entity and opens conflicts where sources disagree; the golden record takes each field from the most trusted source and records its lineage. Full description and the source registry: [data-pipeline.md](data-pipeline.md); the console shows it live as a diagram at `/admin/engine`.

### 4.2 LBR capture

The LBR register cannot be browsed by robots (every search runs a Friendly Captcha), so a person browses it and the extension copies what they open. Details: [services/engine/README.md](../services/engine/README.md), [browser-extension/README.md](../services/engine/browser-extension/README.md), [services/engine/docs/lbr-findings.md](../services/engine/docs/lbr-findings.md).

### 4.3 From the pipeline to the website

One-way: the `publish_proposals` job writes proposals into the website's `ingest_records` with the `fundhub_scraper` role (insert/update on `ingest_*` only), and staff approve them in `/admin/pipeline` (Publish review). The website never reads the Intelligence DB. The other direction — what providers declare on fundhub.lu — enters the pipeline as the `fundhub` source through the read-only `fundhub_engine_ro` role, and is held at the approval gate for a person by default.

## 5. Security model

| Concern | How it is handled |
|---|---|
| Database least privilege | One Postgres role per part (`packages/db/scripts/roles.ts`). `fundhub_web` cannot read staff, audit, email, billing, finance or ingest tables; `fundhub_scraper` writes only `ingest_*` |
| Staff login | Separate `staff_users`, password + mandatory TOTP 2FA, forced own password after any reset or new account (`must_change_password`), roles `owner` / `operations` / `analyst` / `sales`; permissions in `CAN` (`apps/admin/src/lib/auth.ts`); every staff write goes to `audit_log` |
| Visitor login | Own `users` / `sessions`, rate-limited (`rate_limits`) |
| Admin exposure | `X-Frame-Options: DENY`, `noindex`; only reachable through login |
| VM access | SSH by key only; every browser path except `/engine/*` requires an Authelia session (password + TOTP, lockout after 3 failures); the Drive is open to any VM user, code-server (a root shell) only to group `admins` |
| Data intelligence | Metabase on `127.0.0.1` behind Caddy; editor needs Authelia 2FA + a Metabase account; the admin shows dashboards through signed 10-minute embed tokens and lists them with an API key limited by Caddy to two GET endpoints; data sources use read-only roles (`fundhub_bi_ro`: read-only transactions, 30 s timeout; `fundhub_analyst_ro`) |
| Engine on the VM | Postgres and the receiver listen on `127.0.0.1` only; Caddy terminates HTTPS; the receiver requires `Authorization: Bearer <CAPTURE_TOKEN>` and refuses proxied requests without a configured token |
| Secrets | `.env*` files are git-ignored; production values live in Vercel and the VM's `.env` files (mode 600) |
| Untrusted content | Scraped pages and LBR captures are data, never instructions; the AI extractor uses a strict schema |
| Personal data | RCS filings name directors: record the GDPR basis and a retention period; GDPR export/erasure flows in the admin |

## 6. Known gaps and next steps

In order of importance:

1. **Data location.** The website DB is in Neon `us-east-1` and the VM in Azure Central India. FundHub handles EU personal data (directors, accounts): move both to an EU region (Frankfurt / West Europe).
2. **Engine files** (filing PDFs, kept only for service providers and fund GPs) go on a separate Azure data disk ([infra/vm/README.md → Data disk for filing PDFs](../infra/vm/README.md#data-disk-for-filing-pdfs)). Snapshot it regularly. Later, consider object storage (`STORAGE_DRIVER=s3`) and putting the database on its own data disk too.
3. **Social and people sources** (LinkedIn, Glassdoor, Instagram, Facebook, X) are registered but disabled: schema and review policies exist, adapters are phase 2. Their terms forbid scraping; keep to public pages, human pace, and the GDPR minimization in [data-pipeline.md](data-pipeline.md).
4. **Internal data separation.** Finance, CRM, staff and audit tables share the website DB, separated by roles. Next step: move them to an `internal` schema the `fundhub_web` role cannot reach; a separate database later if needed.
5. **Dev and prod on one VM.** The engine runs from the development checkout. Later, run it from a fixed release (the existing `services/engine/Dockerfile`).
