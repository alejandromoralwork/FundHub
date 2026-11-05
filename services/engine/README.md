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

## Admin console (`/admin/engine`)

The admin console has a **Scraping engine** section. It needs `ENGINE_DATABASE_URL` in the console's environment.

| Page | What it does | Who |
|---|---|---|
| Overview | Totals, census against what each source reports, RCS coverage per prefix, RCS session state (pause / resume), queue, runs, latest changes | owner, operations, analyst |
| Registry | Every entity, searchable by name, former name, RCS no., LEI or CSSF code. Filters: kind, service provider, category, status, tier, source, has-RCS | owner, operations, analyst |
| Entity page | Golden record and which source won each field; edit or remove your overrides; classification; clients (add / end); history of every attribute, change events, CSSF statuses, RCS filings, row history | owner and operations can edit |
| Jobs & schedules | Run any job with its parameters, switch schedules on/off, edit the RCS number space, see the queue | owner, operations |
| Match review | Possible duplicates: "Same company" merges them, "Different" keeps them apart | owner, operations |

Engine tables also appear in **Database**, and in the read-only SQL console via `?db=engine`.

**Changes are recorded at three levels:**

1. **Attribute history (`observations`).** Every value each source stated, with the period it held.
2. **Change events (`change_events`).** The feed, with the actor: `staff:<email>`, or `null` for the engine.
3. **Row history (`row_history`).** Database triggers record every row change, including direct SQL, with the actor taken from `app.actor`.

A staff edit is stored as source `manual`. It overrides the registers, and removing it lets the registers win again.

## Getting the first list of RCS entities

> **Tested on 2026-11-04 with a real LuxTrust login: automated browsing of LBR does not work, by LBR's design.** Each search starts a Friendly Captcha check. It never completes in an automated browser, and the engine does not get around it. Full details are in [docs/lbr-findings.md](docs/lbr-findings.md).

The list is built from legitimate sources:

1. **Free official sources, now.**
   * `gleif_sync --full` loads about 73k Luxembourg LEIs and their RCS numbers (`registeredAs`, authority RA000432).
   * `cssf_census` loads all supervised entities.
   * `rcs_seed_frontier` then sets the highest known B-number, and the census shows coverage.
2. **An official LBR extract: the only route to *every* RCS number and to filing PDFs at scale.**
   * Request it under LBR's data-reuse terms, using [docs/lbr-data-reuse-request.md](docs/lbr-data-reuse-request.md), and include filing documents in the request.
   * Then run `rcs_import_file --file extract.csv [--map rcs=<header>,name=<header>]`. Each RCS number becomes an `lbr_bulk` record.
3. **Optional: capture with a person in the loop.** A staff member browses LBR in their own Chrome and saves the company page they are viewing into the engine. That fits a few priority entities, not a census.

### Capture with a person in the loop: the Chrome extension (recommended) or snippet

The **FundHub LBR Capture** extension ([browser-extension/](browser-extension/README.md)) saves every LBR company or search page you open, and every filing PDF your browser receives, with no clicks. On a company page, **Save all documents of this company** opens that company's remaining documents at a human pace and stops on LBR's check or access limit. It never navigates between companies by itself. The snippet below is the manual alternative.

**Capture rounds:** run an *initial* round once, then an *update* round about every month. An update round re-visits captured companies, most-likely-changed first. Unchanged pages cost nothing, and only new filings' PDFs are fetched. Every round is kept in a register: the admin page `/admin/engine/rounds`, or `npm run engine -- round:list`. See [browser-extension/README.md](browser-extension/README.md#capture-rounds-first-full-pass-then-monthly-updates).

#### The snippet

You browse LBR in your own Chrome, where LBR's check passes normally, and a snippet sends the page you are viewing to the engine on your machine. The engine never browses LBR and never calls LBR's internal API.

1. Start the receiver: `cd services/engine && node --import tsx src/cli.ts capture-server`.
   * It listens on `127.0.0.1:4477` and accepts requests from `https://www.lbr.lu` only.
2. Add the snippet once: Chrome → lbr.lu → F12 → **Sources → Snippets → + New snippet** → paste [snippets/lbr-save-to-fundhub.js](snippets/lbr-save-to-fundhub.js) → Ctrl+S.
3. For each company: open it on LBR (search, then company page and its list of filings), then run the snippet with Ctrl+Enter in the snippet or Ctrl+P → `!FundHub save`.
   * A panel shows what was stored: status, name and number of filings.
   * It also links to the **next RCS numbers** from the work list: known from GLEIF or CSSF, not captured yet, service providers first.
4. You can stop at any time. The work list skips numbers already captured, so the next session continues where you stopped.
5. Every page is also saved to `.engine-data/captures/`. After a parser update, `rcs:import-captures` re-imports them. If the receiver was down, the snippet downloads a `.json` file instead; import those with `rcs:import-captures --dir <Downloads>`.

Keep the scheduled browser jobs off: `ENGINE_DISABLED_SCHEDULES=rcs_frontier,rcs_sweep,rcs_refresh`, or switch them off on the console's Jobs page.

## RCS browser tooling (kept for diagnosis)

* **`npm run engine -- rcs:test B145917 [B… …] --wait-file .engine-data/go-rcs`** opens one browser at lbr.lu and waits for your LuxTrust login. It continues when the page shows *My account*, or when the file exists. It then runs each lookup in that same session and parses the result.
  * Each step leaves a screenshot and a page summary (URL, buttons, inputs, links, text) under `.engine-data/rcs-debug/<rcs>-<time>/`.
  * Use it to check whether anything has changed on LBR's side.
* **Use one browser for login and work.** LuxTrust/TAM sessions are session cookies, so they are lost when the browser closes. `rcs:login` followed by a separate process therefore does **not** keep you logged in.
* **What the adapter does with LBR's checks.**
  * It waits for LBR's automatic check to finish (`RcsBrowser.settle()`).
  * If the check asks for a person, or does not finish within 90 s, the session is marked `blocked` and all RCS work pauses.
  * An `AccessLimitation` page does the same.
* **Safeguards for any RCS job:** pacing (`RCS_DELAY_MS` plus jitter), active hours (`RCS_ACTIVE_HOURS`), a daily cap (`RCS_DAILY_CAP`), and one RCS worker only.

> ⚠️ RCS filings contain personal data (directors). Record the GDPR basis and a retention period before collecting them at scale.

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
