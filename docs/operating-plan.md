# Operating plan: continuous collection, time series, financials and business workflows

**Status:** plan (28 Nov 2026). Nothing in this file is built unless marked **built**.
**Related:** [data-pipeline.md](data-pipeline.md) (how the pipeline works today) ·
[data-model-roadmap.md](data-model-roadmap.md) (mandates, people flows, fund launches) ·
[services.md](services.md) · [operations.md](operations.md).

## 1. Goal

FundHub's database is a **history of the Luxembourg fund-services market**, not a snapshot. When something
changed, and in which direction, is often worth more than its current value:
- a ManCo that moved its registered office;
- an administrator whose headcount grew 30% in a year;
- a fund that switched depositary;
- a company whose equity turned negative in its latest accounts.

The plan has four parts:
1. **Collect** every source on a fixed cadence, automatically where the source allows it and through guided
   human sessions where it does not (LBR).
2. **Keep time** in the right shape for each kind of fact: episodes for attributes, observations for numbers,
   events for changes.
3. **Read the filed PDFs** (annual accounts first) and turn them into yearly financial time series per company.
4. **Run the business on written workflows**: who does what, when, with which screen, and what "done" means.

## 2. Principles

1. **Append, never overwrite.** Raw fetches and documents are immutable (**built**: `raw.fetches`,
   `raw.documents`). Every derived layer can be rebuilt from raw.
2. **Two timelines.**
   - **Valid time:** when it was true in the world, e.g. the address since the filing date, the headcount at
     31 Dec.
   - **Record time:** when we observed it, i.e. fetch time.

   Every time-series row carries both, plus a `precision` (day, month, year).
3. **Three shapes of history:**

   | Shape | For | Example | Storage |
   |---|---|---|---|
   | **Episode** | an attribute that holds a value for a period | registered address, name, legal form, status, ManCo of a fund | `valid_from` / `valid_to` rows |
   | **Observation** | a number measured at a date | headcount, LinkedIn followers, sub-fund count, AuM, total assets | one row per (metric, period, source) |
   | **Event** | something that happened | new filing, address change, mandate switch, news mention | `core.changes`, `core.fund_events` (**built**) |

4. **The golden value is a view of history, not a replacement for it.** `core.companies` stays the fast
   "current state" table; history lives next to it and is never lost when the golden value changes.
5. **RCS decides existence, precedence decides conflicts** (**built**: `registry_status`, RCS > CSSF > GLEIF;
   see [data-pipeline.md](data-pipeline.md#existence-rcs-is-the-source-of-truth-registry_status)).
6. **People data is minimised.** Aggregate numbers such as headcount per company are kept long-term. Named
   people only where there is a legal basis, with retention (`retention_purge`, **built**).

## 3. What already records history (built)

| Mechanism | What it gives |
|---|---|
| `clean.claims` (`valid_from` / `valid_to`) | Every value every source ever stated, per attribute, closed when the source changes it. **Per-source** attribute history already exists. |
| `core.changes` | Typed events: `address_change`, `name_change`, `status_change`, `new_filing`, `authorisation_*`, `mandate_*`, `news_mention`… |
| `core.row_history` (trigger) | Every insert / update / delete on `core.companies` and other core tables, with the actor (audit, not analytics) |
| `ops.census_snapshots` | Daily totals per source (seen / new / gone) |
| `core.fund_events`, `core.mandates` | Fund lifecycle and service mandates with real periods |
| `clean.filings` + `raw.documents` | LBR filings list for every captured company; PDFs for the document scope |
| Scheduler (pg-boss) | Daily CSSF census and refresh, GLEIF sync, news every 30 min, website crawl, groups, lifecycle, quality, publish proposals ([jobs-catalog.ts](../packages/engine-db/src/jobs-catalog.ts)) |

**Gaps:**
- There is no **golden-level** episode history: "the address over time" can only be reconstructed from
  per-source claims plus precedence.
- There is no table for **numeric observations** (headcount lives in one column and is overwritten).
- PDF text is never extracted (`raw.documents.text_status` stays `pending`).
- There is no **as-of** query ("what did we know about X on 1 Jan 2025?").
- No LinkedIn source.
- Workflows exist only as tools, not as written routines.

## 4. Data model additions

### 4.1 Golden attribute history: `core.company_attribute_history`

One row per continuous period of one golden value. It is written by `recomputeCompany()`
([entity.ts](../packages/engine-db/src/core/entity.ts)) whenever a golden field changes: the open row is closed
and a new one is opened, inside the same transaction.

```sql
create table core.company_attribute_history (
  id bigserial primary key,
  company_id uuid not null references core.companies(id) on delete cascade,
  attribute text not null,              -- name, address, legalForm, status, website, rcsNumber, lei…
  value jsonb,
  source text not null,                 -- winning source (lineage)
  claim_id bigint references clean.claims(id) on delete set null,
  valid_from date,                      -- real-world start when the source says it (filing / publication date)
  valid_from_precision text not null default 'unknown',
  observed_from timestamptz not null default now(),   -- when we saw it win
  observed_to timestamptz,              -- null = current
  unique (company_id, attribute, observed_from)
);
create index on core.company_attribute_history (attribute, observed_from);
```

- **Backfill:** replay `clean.claims` ordered by `valid_from` through `consolidate()`, once, per company.
- **Marts:**
  - `mart.address_moves`: company, from address, to address, date, from commune, to commune; feeds
    "who moved where" and domiciliation-agent switches;
  - `mart.name_changes`;
  - `mart.status_timeline`.
- **As-of read:** `core.company_as_of(company_id, date)` returns the row valid at that date for each
  attribute. The admin company page gets a **History** tab: a timeline per attribute.

### 4.2 Numeric observations: `core.company_metrics`

```sql
create table core.company_metrics (
  id bigserial primary key,
  company_id uuid not null references core.companies(id) on delete cascade,
  metric text not null references ops.metric_definitions(code),
  period_date date not null,            -- the date the number is FOR (31 Dec for accounts, fetch day for followers)
  period_kind text not null,            -- 'instant' | 'fiscal_year' | 'month'
  value numeric not null,
  unit text not null,                   -- 'people', 'EUR', 'count', 'followers'
  source text not null,                 -- linkedin, website, annual_accounts, cssf, gleif, engine
  evidence jsonb,                       -- {document_sha256, page, url, extract_id}
  confidence real not null default 1,
  observed_at timestamptz not null default now(),
  unique (company_id, metric, period_date, source)
);
create table ops.metric_definitions (code text primary key, label text not null, unit text not null, kind text not null, description text);
```

- **Rule:** a new observation for the same (company, metric, period, source) updates the value only if it
  changed, and the old value goes to `row_history`. A new period is a new row. Never overwrite another
  period.
- **Starting metrics:**

  | Code | Source | Cadence |
  |---|---|---|
  | `headcount` | LinkedIn company page, website, annual accounts (average staff) | monthly / yearly |
  | `linkedin_followers` | LinkedIn | monthly |
  | `funds_managed`, `sub_funds_managed` | CSSF registers + groups (engine-derived) | daily, stored monthly |
  | `domiciliation_clients` | `mart.domiciliation_clients` (engine) | monthly |
  | `filings_count`, `news_mentions` | engine | monthly |
  | `total_assets`, `equity`, `turnover`, `net_result`, `staff_costs`, `avg_staff` | annual accounts (§5) | yearly |

- **Marts:**
  - `mart.metric_series` (company, metric, date, value);
  - `mart.metric_growth`: year-over-year and 12-month change, used for "fastest-growing administrators" and
    lead scoring.
- `core.companies.headcount` becomes "latest observation" and is filled from `company_metrics`, no longer
  written directly.

### 4.3 Snapshots for reports

Monthly `mart.company_month_snapshot` (materialised, refreshed on the 1st): one row per company per month
with its key golden fields and metrics. This makes Metabase trend charts trivial and keeps reports
reproducible ("as published in the March report").

## 5. Reading the PDFs: financial information

**Scope:** filings already saved for the document scope (CSSF non-funds by default, about 1,450 companies).
Start with **annual accounts** (filing types "Comptes annuels" / "Bilan"), then the lists of authorised
signatories, then other filings.

### 5.1 Pipeline (new job group `documents`)

```
raw.documents (pending)
  └─ doc_text      pdftotext per page → text blob (text_blob_key, pages); empty text → text_status = needs_ocr
  └─ doc_ocr       OCR (tesseract, fra+deu+eng) for needs_ocr, low priority
  └─ doc_classify  filing type + language + layout: "eCDF standard chart (PCN)" | "abridged" | "free form"
  └─ fin_extract   - eCDF layout: deterministic parser on the standard line codes (balance sheet / P&L
                     reference numbers), confidence 1
                   - other layouts: Claude extraction with a strict JSON schema (line items, currency,
                     fiscal year, page per value), confidence from the model + arithmetic checks
  └─ fin_validate  assets = liabilities + equity, P&L subtotals add up, the year matches the filing,
                   the currency is known → pass, or hold for review
  └─ fin_release   → clean.financial_statements + core.company_metrics (period_kind = fiscal_year)
```

- **Tables:**
  - `clean.financial_statements`: one row per (company, fiscal year end, document), with currency,
    standard, `items jsonb` (code → value), extraction method, `checks jsonb` and status;
  - `clean.financial_items` (optional, normalised): one row per line.
- **Review:** a new **Review → Financials** tab. It shows the PDF page next to the extracted values; staff
  approve or correct, and `manual` wins as everywhere else. Policy: eCDF plus all checks passing → auto;
  otherwise review.
- **Cost control:**
  - deterministic eCDF parsing first (most Luxembourg accounts follow the standard chart);
  - the model only for the rest, and only page ranges classified as balance sheet / P&L;
  - model and effort from `ANTHROPIC_MODEL` / `EXTRACTION_EFFORT` (**built**,
    [config.ts](../services/engine/src/config.ts));
  - a monthly token budget setting, with the job stopping when it is reached.
- **Output on the website / reports:**
  - per company: 5-year series of total assets, equity, turnover, result and staff;
  - per segment: median growth of administrators, ManCos, domiciliation agents;
  - flags: negative equity, going-concern notes, auditor change (ties into mandates, roadmap step 3).

### 5.2 Other documents (later)

- **Lists of signatories / board:** people episodes, under the GDPR rules in
  [data-pipeline.md](data-pipeline.md#personal-data).
- **Articles / statutes:** corporate purpose, share capital over time (an observation).
- **Fund prospectuses and annual reports:** service providers per fund (roadmap step 3, mandates from
  documents).

## 6. Collection cadence (target)

| Source | How | Cadence | Job(s) | Produces history of | Status |
|---|---|---|---|---|---|
| **CSSF** registers | API | daily census + refresh | `cssf_census`, `cssf_refresh` | authorisations, entity types, funds and sub-funds, managers | built |
| **GLEIF** | API (golden copy) | daily | `gleif_sync` | LEI status, legal / HQ address, parent relations, fund relations | built |
| **LBR / RCS** company pages + PDFs | person + extension (LBR blocks robots) | **update round monthly** (CSSF entities first), initial rounds until done; PDFs during the same visit | rounds, `rcs_refresh` queue | name, address, status, legal form, filings, documents | built (manual sessions) |
| **LBR** search sweep | person + extension | weekly session until the sweep is complete, then monthly for new numbers | `sweep:*` | new companies, struck-off flags | built |
| **News** | RSS + search | every 30 min / daily | `news_poll`, `news_search` | articles, company mentions (events) | built |
| **Company websites** | crawler + AI extraction | daily batch; each site re-crawled every 30 days | `website_crawl` | services, clients, contacts, logo | built |
| **LinkedIn** | **decide first** (§9): licensed data vendor or manual monthly check of company pages | monthly | `linkedin_company` (new) | headcount, followers, employee locations (aggregates only) | new |
| **Annual accounts** | PDFs already captured | on arrival + weekly catch-up | `doc_text`, `fin_extract`… (new) | financial series | new |
| **Engine-derived metrics** | SQL | monthly on the 1st | `metrics_monthly` (new) | funds managed, clients, filings, mentions | new |
| **FundHub accounts** | website DB | hourly | `fundhub_sync` | self-declared profile changes | built |

Rules for every new source:
- an adapter in `services/engine/src/sources/<name>/`, plus parser fixtures and tests;
- a row in `ops.sources` with its rate limit and compliance note;
- a review policy;
- a job in `jobs-catalog.ts` with its cron;
- a census snapshot, so a silent outage shows up as "seen = 0".

## 7. Business workflows

Each workflow names a trigger, an owner, the screen to use, and what "done" means. They should become a
checklist in the admin (**Operations → Today**) that lists what is due.

### Data operations

| # | Workflow | When | Owner | Where | Done when |
|---|---|---|---|---|---|
| D1 | **Morning health check** | daily, 5 min | ops | `infra/vm/bin/health.sh`; Admin → Scraping engine → Jobs / Quality | all services active, no failed runs since yesterday, quality checks green, disks under 85% |
| D2 | **Review queue** | daily, 15–30 min | analyst | Admin → Company intelligence → Review (staging, matches, conflicts, mentions, rejects; later financials) | every queue under its target age (staging under 2 days, conflicts under 7 days) |
| D3 | **LBR capture session** | 2–3 sessions per week, 45 min | analyst | Chrome extension: active round, filter **CSSF entities**, "Save all documents" on | round progress moves; `pending` registry status for CSSF entities goes down (BI tile 09) |
| D4 | **Monthly update round** | 1st working day | analyst | console → Capture rounds → New round (update, CSSF entities, skip 20 days) | round closed by the 20th |
| D5 | **Financials QA** | weekly | analyst | Review → Financials | held statements cleared; 5 random auto-approved ones spot-checked |
| D6 | **Publish to website** | weekly | owner | Admin → Data pipeline → Publish review | engine proposals accepted or rejected field by field |
| D7 | **Monthly data close** | 1st–3rd of month | ops | jobs `metrics_monthly`, snapshot refresh; Metabase | `mart.company_month_snapshot` for the month exists; dashboards refreshed |

### Commercial operations

| # | Workflow | When | Owner | Where | Done when |
|---|---|---|---|---|---|
| C1 | **Provider claims and profile edits** | on arrival, under 2 working days | operations | Admin → Claims, Edits | claim verified (RCS / domain match) and approved or refused |
| C2 | **Review moderation** | on arrival, under 2 working days | operations | Admin → Reviews | published or rejected with a reason |
| C3 | **RFI / requests from funds** | on arrival, under 1 working day | sales | Admin → Requests (+ Twenty CRM) | shortlist sent; request logged in CRM with the providers contacted |
| C4 | **Lead list from signals** | weekly | sales | Metabase: growth, new ManCos/AIFMs, fund launches, address moves, negative equity | 10 qualified leads into the CRM |
| C5 | **Data Intelligence report** | monthly | owner | Metabase → PDF → Admin → Reports | report uploaded, members notified (Listmonk) |
| C6 | **Member alerts** (new) | weekly digest | automatic | `core.changes` filtered by each member's watchlist | email sent: address changes, new filings, financials, mandate switches of watched companies |

### Company operations

| # | Workflow | When | Owner | Where | Done when |
|---|---|---|---|---|---|
| O1 | **Billing month-end** | 1st–5th | owner | Admin → Billing, Finance (Stripe) | invoices issued, unpaid followed up, MRR booked |
| O2 | **GDPR requests** | on arrival, under 30 days by law | owner | Admin → GDPR | answered and logged |
| O3 | **Backup restore test** | monthly | ops | [infra/vm/README.md → Restore](../infra/vm/README.md#restore-a-backup) | a dump restored into a scratch DB and row counts compared; PDF copy checked |
| O4 | **Security and access review** | quarterly | owner | [access-and-recovery.md](access-and-recovery.md), [secrets.md](secrets.md) | leavers removed, tokens rotated (`CAPTURE_TOKEN`, API keys), 2FA checked |
| O5 | **Source compliance review** | quarterly | owner | `ops.sources` compliance notes | each source's terms re-read; LBR re-use request status ([lbr-data-reuse-request.md](../services/engine/docs/lbr-data-reuse-request.md)) |

## 8. Build phases

Each phase is shippable on its own and ends with its checks green.

| Phase | Deliverables | Done when |
|---|---|---|
| **0. Operate what exists** (now) | Migration 0008 applied, recompute, data disk attached; D1–D4 routines started | PDFs land on `/srv/fundhub-data`; CSSF-entity rounds running |
| **1. Golden history** | `core.company_attribute_history` + backfill; `mart.address_moves`, name and status timelines; History tab on the company page; `company_as_of()` | an address change captured on LBR shows as a closed and an opened episode, and in `mart.address_moves` |
| **2. Metrics** | `ops.metric_definitions`, `core.company_metrics`, `metrics_monthly` job, `mart.metric_series` / `metric_growth`, monthly snapshot; Metabase "Market trends" dashboard | 3 months of engine-derived metrics; headcount column fed from metrics |
| **3. Documents → text** | `doc_text`, `doc_ocr`, `doc_classify` jobs; `text_status` / `pages` filled | over 95% of saved PDFs have text or `needs_ocr` handled |
| **4. Financials** | eCDF parser, Claude fallback, validation, Review → Financials, release to metrics; company-page Financials tab | 5-year series for at least 500 companies; spot-check error under 2% |
| **5. LinkedIn (aggregates)** | after the §9 decision: adapter, monthly headcount and followers | monthly headcount for the top 300 service providers |
| **6. Alerts and workflows in the product** | watchlists, weekly digest (C6), Operations → Today checklist in the admin | members receive digests; the checklist replaces this table |
| **7. Mandates from documents** | roadmap steps 3–4 ([data-model-roadmap.md](data-model-roadmap.md#6-build-order)) | provider wins and losses dashboard |

## 9. Decisions to take

1. **LinkedIn:**
   - LinkedIn's terms forbid scraping. Options: a licensed data vendor (cost per company per month), the
     official API (restricted), or a manual monthly check of company pages for the top N (cheap, slow).
   - **Recommendation:** aggregates only (headcount, followers) from a vendor or by hand for the top 300; no
     named employees until the GDPR assessment is done.
2. **LBR re-use:** whether LBR grants an extract and document delivery (draft request exists). If it does,
   D3/D4 shrink to checks and the person-driven capture becomes a fallback.
3. **Financials scope:** annual accounts of the document scope only, or also funds' annual reports (much
   larger volume and more model cost). **Recommendation:** document scope first; funds in roadmap step 3.
4. **Model budget:** a monthly cap on extraction spend. Set it before phase 4 starts.
5. **Retention:**
   - raw pages and PDFs: forever (they are evidence);
   - named-person data: per the GDPR policy;
   - capture files: forever while they are small and gzipped; revisit at 10 GB.

## 10. Risks

| Risk | Mitigation |
|---|---|
| History tables grow without bound | Episodes, not snapshots (a row only on change); metrics one row per period; monthly snapshot only for marts |
| A source silently stops (layout change, login expired) | census snapshots + quality checks + D1; parser version bump re-parses from raw |
| Wrong financials published | validation checks, review gate, confidence shown, `manual` wins, page reference kept for every value |
| Person-driven LBR capture does not scale | CSSF-first rounds, sweep, LBR re-use request; registry status shows what is still pending |
| Scraping terms / GDPR | `ops.sources` compliance notes, aggregates first, O5 quarterly review |
