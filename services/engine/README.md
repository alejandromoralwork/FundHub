# FundHub Scraping Engine

An independent service that builds **one registry of every Luxembourg entity**: a "golden record" per real company, merged from the official registers and enriched from websites, with the full history of every change. It feeds the website (through the existing `/admin/pipeline` review) and the Data Intelligence products.

| Source | What it gives | Access | Census ("how many exist") |
|---|---|---|---|
| **CSSF eDesk** | Supervised entities: type (Specialised PFS, ManCo, AIFM, bank, UCI…), authorised and other statuses with dates, name history, LEI, fund compartments | Public JSON API, no login | Exact: the API reports `totalElements` per entity type |
| **GLEIF** | The LEI ↔ **RCS number** bridge (`registeredAs`, authority `RA000432`), legal address, status | Public API, no key | Exact: about 73k LU records; daily delta by `lastUpdateDate` |
| **RCS / LBR** | Legal form, registered office, registration date, status, **every filing** (number, date, type, corrections) and filing PDFs | Your **LuxTrust** session, in a real browser | Sequential numbers per prefix: a frontier probe finds new numbers, a sweep backfills |
| **Web agent** *(phase 6)* | Website, services, team, clients | Claude with web search | — |

## How it fits together

```
 scheduler (cron) ─▶ pg-boss queue (in the engine DB) ─▶ workers: cssf · gleif · maintenance │ rcs (one, with browser)
                                                              │
     adapter.fetch ─▶ raw bytes ─▶ object storage (sha256-addressed; fs or S3)
     adapter.parse ─▶ ParsedRecord ─▶ core/ingest.ts:
         content hash unchanged? → touch last_seen
         changed → capture row → diff → change_events
                 → observations (attribute history, SCD2)
                 → resolve entity (RCS no. → LEI → CSSF code → name+postcode; merge when ids agree)
                 → CSSF details / RCS filings
                 → golden record (source precedence) + classification (rules) + tier
```

* **Tables:** listed in [packages/engine-db/src/schema.ts](../../packages/engine-db/src/schema.ts). The main table is `entities`, with `is_service_provider`, `entity_kind`, `activity_category_id`, `activity_subcategory_id` and `tier`.
* **Provider profile fields:** these are filled by the web agent and by future sources.

  | Engine field | What it holds | Website field (when promoted) |
  |---|---|---|
  | `entities.website` | The website, ranked web > GLEIF > CSSF | `website` |
  | `entities.website_verified_at` | When the site's legal notice was confirmed to show the entity's RCS number | — |
  | `entities.operating_countries` | ISO codes (`LU`, `IE`…); `normalizeCountries()` accepts names in English or French | `footprint`, as country names via `countryName()` |
  | `entities.logo` | `{ blobKey, sourceUrl, mime, sha256, bytes }`, stored by `storeLogo()` in [core/media.ts](src/core/media.ts) | needs a new column |
  | `entity_relations` | Who works for whom: provider → client, with the role (`client`, `administrator`, `depositary`, `auditor`…) and the evidence URL. Clients are matched to their own entity when the name is unique; the weekly `reclassify` job retries the matching. | `topClients` |

  A client that disappears from the source is ended (`valid_to`) and produces a `relation_ended` event; it is never deleted.
* **Classification:** comes from `classification_rules`, seeded in [seed-data.ts](../../packages/engine-db/src/seed-data.ts) to map CSSF types and activity codes to categories. Rules never override a `manual` classification.
* **Tiers:**

  | Tier | What the engine collects |
  |---|---|
  | 0 | Metadata only |
  | 1 | Metadata plus filing PDFs |
  | 2 | Metadata, PDFs, the web agent, and weekly RCS refresh |

  The tier also sets refresh frequency: see `refreshDays()` in [core/ingest.ts](src/core/ingest.ts).
* **Adding a source:** add a folder in `src/sources/` that implements `SourceAdapter` (`fetch` plus a pure `parse`), then add its jobs in [jobs/index.ts](src/jobs/index.ts).

## Run it locally (no Docker needed)

```sh
npm install
npm run engine:db:local            # terminal 1: Postgres on :5434 (data in packages/engine-db/.pg-data)
npm run engine:db:setup            # terminal 2: migrations + categories, rules, RCS prefixes

npm run engine -- run cssf_census --types SPP,SUP     # list types, fetch details inline
npm run engine -- run gleif_sync --limit 1000         # omit --limit for the full LU load
npm run engine -- run census_snapshot
npm run engine -- status
npm run engine -- entity B145917
```

By default, raw files go to `services/engine/.engine-data/` (`STORAGE_DRIVER=fs`).

To run with the queue, start the processes:

```sh
npm run engine -- scheduler
npm run engine -- worker --groups cssf,gleif,maintenance
```

## RCS with your LuxTrust account

1. Log in: `npm run engine -- rcs:login`. A browser opens on lbr.lu. Log in with LuxTrust, check that a company page opens, then press Enter. The session is stored in `RCS_PROFILE_DIR`, and `session_health.rcs` is set to `ok`. **RCS jobs do not run until this is done.**
2. Capture one page: `npm run engine -- rcs:capture B145917`. Open the company's "List of filings" and press Enter.
   * The page's text and HTML are saved under `test/fixtures/`, and the parser is run on them.
   * Do this once for an active company, a struck-off company and one in liquidation. Then adjust [rcs/parse.ts](src/sources/rcs/parse.ts) and the URL and selectors (`RCS_ENTITY_URL_TEMPLATE`, `RCS_SEARCH_INPUT`) to the real site.
3. Fetch one company: `npm run engine -- run rcs_fetch --rcs B145917`.
4. Set the starting point for new registrations: `npm run engine -- run rcs_frontier --prefix B --from <a recent B number>`.
5. Start the RCS worker: `npm run engine -- worker --groups rcs`. Run **only one**.

**Safeguards**

* Pacing: `RCS_DELAY_MS` plus jitter between requests.
* Activity window: `RCS_ACTIVE_HOURS`.
* Volume: a daily cap, `RCS_DAILY_CAP`.
* Bot checks: a logout or bot check marks the session `logged_out` or `blocked`. All RCS work then pauses until you run `rcs:login` again. The engine never tries to get past a captcha.
* Order of work: the `rcs_refresh` job first queues companies already known from CSSF and GLEIF, highest tier first, so service providers and asset managers come before the blind sweep.

> ⚠️ Before running bulk sweeps, check LBR's terms of use and data-reuse licence. LBR also sells official bulk data, which is safer and faster. If you take that route, swap it in as another adapter. RCS filings contain personal data (directors), so record the GDPR basis and a retention period before collecting them at scale.

## Deploy: Docker, Azure VM, any cloud

```sh
cp services/engine/.env.example services/engine/.env      # edit as needed
docker compose -f services/engine/docker-compose.yml up -d --build                 # Postgres, MinIO, worker, scheduler
docker compose -f services/engine/docker-compose.yml --profile rcs run --rm -p 127.0.0.1:6080:6080 engine-rcs rcs:login
docker compose -f services/engine/docker-compose.yml --profile rcs up -d engine-rcs
```

* **One image, every role:** the image runs all roles. The worker container applies migrations and seed data on start (`ENGINE_MIGRATE=1`).
* **Managed services:** to use a managed Postgres and bucket, set `ENGINE_DATABASE_URL` and `S3_*` in `.env`, then start only `engine-worker` and `engine-scheduler`. Managed Postgres options include Neon and Azure Database for PostgreSQL; bucket options include R2 and Azure Blob behind an S3 gateway.
* **Logging in on a VM:** for `rcs:login`, open noVNC through an SSH tunnel with `ssh -L 6080:localhost:6080 vm`, then go to http://localhost:6080/vnc.html.
* **Safe first deploy:** set `ENGINE_DISABLED_SCHEDULES=rcs_sweep,rcs_frontier` and run the CSSF and GLEIF jobs by hand. Once the census looks right, remove the setting.

## Schedules (Europe/Luxembourg)

| Job | When |
|---|---|
| `cssf_census` (all types, marks withdrawn ids `gone`) | Sun 02:00 |
| `cssf_refresh` (records due) | daily 03:00 |
| `gleif_sync` (delta) | daily 04:00 |
| `rcs_refresh` (known-but-unfetched first, then due) | daily 07:30 |
| `rcs_frontier` B (new registrations) | daily 08:15 |
| `rcs_sweep` B (backfill, self-chaining) | daily 10:00 |
| `census_snapshot` | daily 23:30 |
| `reclassify` | Sun 05:00 |

## Tests

```sh
npm test -w @fundhub/engine
```

The tests run on real fixtures: the CSSF and GLEIF records of Arendt, plus its RCS page. They check:

* every parser;
* that the three sources resolve to **one** entity in any order;
* that a new filing produces exactly one `new_filing` event;
* golden-record precedence;
* classification.

## Not built yet (next phases)

* **PDF download and text extraction** (phase 5). `RcsBrowser.download()` and the `documents` table exist. The job needs the real document links from a captured page.
* **AI web agent** (phase 6). Reuse `services/scraper/src/crawl.ts` and the extraction in `ai-web.ts`.
* **Promoter to the website DB** (phase 7). It creates `staged` providers and `ingest_records` for `/admin/pipeline`. It needs `providers.lei`, `providers.cssf_number` and `providers.engine_entity_id`.
* **A read-only `/registry` page in the admin console.** It would show the census, queue, session health, change feed and the `match_candidates` review.
