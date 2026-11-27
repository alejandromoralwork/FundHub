# Company Intelligence pipeline

FundHub's goal is the most complete database of Luxembourg companies. LBR gives the master list, and every other source enriches it and cross-checks it. This page describes how data flows, which tables hold it, and where a person decides.

The live version of this diagram, with row counts, is at **Admin → Company intelligence → Pipeline** (`/admin/engine`).

## Dataflow

```mermaid
flowchart LR
  subgraph SRC[Sources]
    LBR[LBR company pages · rcs]
    LBRB[LBR extracts & search lists · lbr_bulk]
    GLEIF[GLEIF · gleif]
    CSSF[CSSF · cssf]
    FH[FundHub accounts · fundhub]
    WEB[Company websites · website]
    NEWS[News feeds & search · news]
    SOC[LinkedIn · Glassdoor · Instagram · Facebook · X<br/>phase 2, disabled]
  end
  SRC -->|acquire| RAW[(raw<br/>fetches · documents)]
  RAW -->|parse| STG[(staging<br/>source_records · parsed_records)]
  STG --> GATE{approval gate<br/>ops.review_policies}
  GATE -->|approved / not required| CLEAN[(clean<br/>claims · rejects · licences · filings · web_pages · articles)]
  GATE -.->|pending| PERSON([Review → Staging approval])
  PERSON -.-> CLEAN
  CLEAN -->|resolve + cross-check| MATCH[(match<br/>candidates · conflicts)]
  MATCH -->|consolidate| CORE[(core — golden records<br/>companies · people · positions · web_presence · news_mentions · relations · field_lineage · changes)]
  CORE --> MART[(mart views)]
  CORE -->|publish_proposals| ING[website DB: ingest_records]
  ING -->|staff accept field by field| PROV[website DB: providers]
  PROV -.->|fundhub_sync, read-only| FH
```

The `ops` schema spans every layer. It holds the source registry, attribute precedence, review policies, runs, census, quality checks, LBR capture tooling and news feeds.

## Layers

| Layer (Postgres schema) | What happens | Tables | Code |
|---|---|---|---|
| **raw** | Every acquired content version is stored once and never updated. Its bytes go to object storage, addressed by SHA-256. Unchanged content is not stored again. | `fetches`, `documents` | `pipeline/ingest.ts` |
| **staging** | One row per id at a source. Every parsed version is kept in the source's own vocabulary. An unchanged version stops here, detected by hash. | `source_records`, `parsed_records` | `pipeline/ingest.ts`, `sources/*/parse.ts` |
| **approval gate** | Optional human check. The source's review policy decides whether a version flows on or waits for a person. | `ops.review_policies`, `parsed_records.review_status` | `pipeline/gate.ts` |
| **clean** | Validates and normalizes values (detail below). Facts become claims with history (SCD-2). Refused values become rejects, never silent drops. | `claims`, `rejects`, `licences`, `filings`, `web_pages`, `articles` | `pipeline/clean.ts` |
| **match** | Links a record to a company (detail below). Doubtful matches become candidates. Disagreements between sources become conflicts. | `candidates`, `conflicts` | `core/resolve.ts`, `pipeline/mentions.ts` |
| **core** | Golden records. Each field comes from the most trusted source that states it, and its lineage records which claim won and how many sources agree. Also holds people, positions, web and social presence, news mentions, relations and the change feed. | `companies`, `company_*`, `people`, `positions`, `web_presence`, `news_mentions`, `review_summaries`, `field_lineage`, `changes`, `row_history` | `packages/engine-db/src/core/entity.ts`, `core/golden.ts` |
| **mart** | Read models for the console and analytics. | views `company_profile`, `company_licences`, `coverage_by_source`, `field_completeness`, `pipeline_counts` | `packages/engine-db/drizzle/0001_pipeline_sql.sql` |
| **publish** | Compares golden records with their FundHub listing and writes proposals into the website's review queue. | website `ingest_records` (source `engine`) | `pipeline/publish.ts` |

**Clean stage** rules:
- names
- RCS numbers and LEIs
- URLs: https, no tracking parameters
- e-mails: generic company inboxes only, never a person's address
- phones in E.164 format
- Luxembourg postcodes as `L-1234`
- ISO dates and country codes

**Match stage** order:
1. RCS number, LEI, CSSF id or FundHub listing
2. a verified website domain
3. name and postcode

All code paths are under `services/engine/src/` unless they start with `packages/`.

## Sources

| Code | System | Kind | Acquisition | Status |
|---|---|---|---|---|
| `rcs` | LBR | register (the master list) | a person browses lbr.lu, and the extension captures the pages | built |
| `lbr_bulk` | LBR | register | official extract files and LBR search lists | built |
| `gleif` | GLEIF | secondary register | API, daily delta | built |
| `cssf` | CSSF | regulator (licences) | API | built |
| `fundhub` | FundHub | self-declared | read-only role on the website DB: listings, approved claims, approved self-edits | built |
| `website` | Company website | web | crawl plus Claude extraction | built |
| `news` | News | news | six Luxembourg RSS feeds, plus a per-company news search for followed companies | built |
| `linkedin`, `glassdoor`, `instagram`, `facebook`, `x` | social, people, reviews | phase 2 | public pages only | registered, disabled |
| `manual` | FundHub staff | staff edits | console | built (always wins) |

The website source is held to strict rules:
- It respects robots.txt.
- A site is **verified** only when its pages state the company's own RCS number. Only a verified site contributes identifiers, so a wrong website can never merge two companies.
- Team members are stored with name, title and page link only.

`rcs` and `lbr_bulk` are both LBR, but they stay separate codes because both key their records on the RCS number.

### Precedence (who wins each golden field)

| Kind of field | Fields | Most trusted first |
|---|---|---|
| Legal facts | name, legal form, status, address, registration date, RCS number | `rcs` → `lbr_bulk` → `cssf` / `gleif` → `fundhub` → `website` |
| Descriptive facts | description, services, headcount, contacts | `fundhub` → `website` → `linkedin` |

- Licences come only from the CSSF.
- `manual` (a staff edit) always wins. Clearing it hands the field back to the sources.
- The full ranking is the `ops.attribute_precedence` table, shown on the Sources page and editable in the Database module.
- After changing precedence, run `reprocess --source <code> --from consolidate`.
- **Name and address are pure precedence:** a staff edit first, then LBR (company pages `rcs`, then extracts `lbr_bulk`), then CSSF, then GLEIF, FundHub and the website. A mismatch never opens a conflict for a person; it shows in the field's lineage (sources agreeing / total) on the company's Lineage tab. Conflicts are still opened for legal form, status, RCS number, LEI, registration date and website (`CONFLICT_ATTRIBUTES` in `packages/engine-db/src/core/golden.ts`).

### Staging approval policies (defaults, editable on the Sources page)

| Source | Policy |
|---|---|
| `rcs`, `gleif` | held when a legal fact changes or the parser version changed |
| `cssf` | held when name, status or LEI changes, or the parser version changed |
| `lbr_bulk` | held when name or status changes |
| `fundhub` | every record is reviewed |
| `website` | held when the AI confidence is below 80% |
| `news` | articles flow automatically; uncertain company mentions wait in Review → Mentions |
| social and people | every record is reviewed |

Approving a version queues `staging_release`, which runs clean → match → core. "Edit and approve" turns the corrected golden fields into staff claims. Rejected versions stay in staging for audit.

## Fund profile and company groups

Every company carries a **fund profile** next to its kind. It's derived on each recompute by `packages/engine-db/src/core/fund-profile.ts`. A staff classification (Change → Save as manual) freezes it.

| Field | Values | Evidence, strongest first |
|---|---|---|
| `fund_regime` | UCITS · AIF · other | CSSF group `OPCLUX_1` (2010 Law Part I) = UCITS. `OPCLUX_2`, SIF, SICAR and RAIF are AIFs. Any other fund is an AIF, because UCITS always appear on the CSSF Part I list. Sub-funds inherit from their umbrella. |
| `fund_law` | 2010 Part I · 2010 Part II · SIF · SICAR · RAIF · securitisation · pension | CSSF type (OPC, FIS, SIC, TIT, PF), then RAIF / SICAR / SIF in the name |
| `legal_vehicle` | FCP · SICAV · SICAF · SCSp · SCS · SCA · S.A. · S.à r.l. · SAS · cooperative · sub-fund | CSSF sub-group (`OPCLUX_x_1` = FCP, `_2` = SICAV, `FIS1/2/3`), GLEIF legal form, RCS legal form, name suffix |
| `fund_role` | standalone fund · umbrella · sub-fund · master · feeder · general partner · SPV · holding | The company's role in its fund-structure group; GLEIF "SUB-FUND"; CSSF sub-funds (umbrella); the name ("… GP S.à r.l." = GP, TopCo / BidCo / HoldCo = SPV) |
| `manager_type` | super-ManCo · UCITS ManCo · Chapter 16 ManCo · authorised AIFM · registered AIFM · branches | CSSF types C15, C16, AIFM_AUT, AIFM_REG, AIFM_REG_LU_OTHER_EU_MEMBER_STATE |

The company kinds are `fund` (funds and sub-funds), `fund_vehicle` (GP, SPV, fund holding) and `asset_manager` (ManCos and AIFMs). Regulated kinds from the CSSF rules (bank, service provider, financial institution) are never overridden by the profile.

**Groups** (`core.company_groups`, `core.company_group_members`) form a tree in three layers:

```
corporate          Corporate group (ultimate parent)            ← GLEIF consolidation, international branches
                    └ subsidiaries / branches
fund               Fund platform (one ManCo / AIFM)              ← GLEIF "is fund-managed by"   (parent: its corporate group)
                    └ Fund structure (umbrella / master / fund)  ← GLEIF "is sub-fund of" / "is feeder to", CSSF sub-funds
                       └ sub-funds · feeders · GP · SPVs · holdings   (GP matched by name; SPV / holding = GLEIF parent is a fund)
service_provider   Provider group                                ← the service providers of a corporate group, or a shared brand word (50 %)
```

- **Build:** the job `build_groups` (daily 14:00) rebuilds every generated group from three things:
  - GLEIF's daily relationship file (golden copy, about 25 MB, read through `unzip`);
  - the CSSF sub-funds, each of which becomes a sub-fund company with identifier `cssf_compartment` (plus its LEI);
  - name rules.
- **Reclassify:** afterwards it reclassifies the companies whose place changed, so sub-funds inherit their umbrella's UCITS / AIF profile.
- **Staff edits:** groups and memberships that staff create, edit or remove in **Company intelligence → Groups** are stored as `manual`, and the builder never changes them.
- **Views:** `mart.group_tree` (depth and path), `mart.group_members`, and `mart.company_profile` (with `corporate_group`, `fund_platform`, `fund_structure`).

**CSSF types walked by `cssf_census`:**
- every non-empty supervised type (service providers, ManCos, AIFMs, banks, investment firms, payment and e-money institutions, funds: OPC, FIS, SIC, TIT, PF…);
- the membership lists FGD, SII, AGD and SGD.

**Not walked, on purpose:**
- OEX (foreign funds marketed in Luxembourg);
- EMT (issuers, mostly foreign);
- CRD (third-country institutions operating cross-border).

## Service mandates and fund lifecycle

**Mandates** (`core.mandates`, evidence in `core.mandate_evidence`, roles in `ops.mandate_roles`) record who serves each fund and sub-fund (ManCo / AIFM, depositary, central administration, auditor…), as **episodes with real dates**:
- `valid_from` and `valid_to`, each with a precision of day, month, year or unknown;
- separately, when we first and last saw it.

A switch ends the old episode and starts a new one (`core.changes`: `mandate_started`, `mandate_switched`, `mandate_ended`). For one-at-a-time roles (`exclusive`), the database refuses overlapping episodes. Staff add or end mandates on the company page (Service providers tab), and builders never change staff episodes.

- **Today's source:** GLEIF `IS_FUND-MANAGED_BY`, with its relationship start date. `build_groups` syncs it daily, and the role (`management_company` or `aifm`) follows the manager's licence and the fund's regime.
  - **GLEIF onboarding caveat:** GLEIF began collecting fund relationships in spring 2023, so a start date between 2023-03-01 and 2023-06-30 is stored as approximate ("on or before"), not as an appointment.
  - **History limit:** GLEIF shows only the *current* manager. Changes are therefore inferred when a manager starts more than six months after the fund (`manager_changed`, previous manager unknown), and are recorded directly as they happen from now on.
- **Next sources** ([data-model-roadmap.md](data-model-roadmap.md)): annual reports and prospectuses (depositary, administrator, transfer agent, auditor), dated per document.

**Fund lifecycle:** the job `fund_lifecycle` (daily 14:30) rebuilds `core.fund_events` and sets `launch_date` and `closure_date` on every fund and sub-fund. The events are:
- incorporated (GLEIF / RCS creation date);
- authorised (CSSF);
- launched (CSSF sub-fund start);
- sub-fund added or closed;
- manager appointed or changed;
- deregistered;
- closed.

**Marts:**

| View | What it gives |
|---|---|
| `mart.fund_launches` | Each launch with the manager at launch time |
| `mart.manager_momentum` | Launches in the last 12 months vs the 12 before, and first launch (leads) |
| `mart.mandates_current` | Current mandates with the provider's group |
| `mart.mandate_switches` | Provider A → B per fund and role |
| `mart.graph_edges` | One edge list for node diagrams |

The Metabase dashboard **Fund launches & managers** reads these.

## Who is a service provider

A **service provider** is any company providing services to funds or corporates. The classification rules (`core.classification_rules`, editable in the Database module) set the flag from four kinds of evidence:
- **CSSF licences:** specialised and support PFS, banks (depositary, banking), investment firms, ManCos and AIFMs (management services).
- **Names**, for firms the CSSF does not license (rule kind `keyword`: a regular expression on the plain name):
  - law firms (avocats, Rechtsanwälte, and the Luxembourg law-firm brands such as Arendt & Medernach, Elvinger Hoss Prussen, Loyens & Loeff…);
  - audit and accounting firms (Deloitte, PwC, KPMG, EY, Grant Thornton, BDO, RSM…);
  - tax advisers;
  - fiduciaries, domiciliation and corporate services, and fund administrators (Alter Domus, TMF, Vistra, IQ-EQ, JTC…);
  - consulting and advisory firms.

  Name rules never apply to funds, fund vehicles or managers. The generic word rules also skip names that read as investment vehicles (SCSp, lending, investments, holding, fund…).
- **The FundHub directory:** every provider listed on fundhub.lu, through the `fundhub` source. This needs `WEBSITE_DATABASE_URL_RO` on the VM (see [operations.md](operations.md)).
- **Staff:** the company page → Classification → Change.

`reclassify` (Mondays, or on demand) re-applies the rules to every company that is not struck off; `--all` includes struck-off ones.

## Services offered and domiciliation by address

**Services offered** (`core.company_services`): a company can offer several categories and services. They follow the website's taxonomy (fundhub.lu/services: category → services, the same list as `core.activity_categories`), plus free-text services the taxonomy does not have. Each row records its source and period:
- `rule`: every category and service the classification rules give, from CSSF licences;
- `fundhub` and `website`: the services those sources state in words, matched to the taxonomy by label;
- `manual`: staff, set from the company page ("Services offered" → Edit). Sources never overwrite staff rows.

The primary category stays on `core.companies`. The Companies list's category filter matches any service a company offers. View: `mart.company_services`.

**Domiciliation by shared address:** the job `domiciliation_match` (daily 14:45) works like this:
- **Who counts as a provider:** a service provider offering Fund Administration (the category or any of its services) or Domiciliation & Registered Office.
- **The address key:** Luxembourg postcode + house number, e.g. `L-2520|5`. A postcode covers one street, so spelling doesn't matter.
- **The match:** an active entity at a provider's address is recorded as its **domiciliation client**: a `core.mandates` episode, role `domiciliation_agent`, decided by `address_match`, confidence 0.8. The start date is when the address was first seen ("on or before").
- **Not counted as clients:**
  - the provider's own group companies;
  - other service providers;
  - entities at a building shared by two unrelated providers (counted as ambiguous; nothing is recorded).
- **History:** the episodes form each company's register of administrators. A move to another administrator's address ends one episode and starts the next (`mandate_switched`); leaving ends it.
- **Who wins:** domiciliation mandates from staff or documents always win.
- **Views:** `mart.domiciliation_clients` and `mart.mandate_switches`; the Metabase dashboard is "Fund administrators & domiciliation".

## Filing documents (PDFs)

The LBR filings list is kept for every captured company. The filing PDFs themselves are kept only for two groups:
- **service providers**;
- **general partners of funds** (`fund_role = general_partner`).

The rule lives in `packages/engine-db/src/core/document-scope.ts`. The capture server refuses PDFs for any other company, and the browser extension offers "Save all documents" (and the automatic download) only for the two groups. Files sit on the VM's data disk (`STORAGE_ROOT`, see [infra/vm/README.md](../infra/vm/README.md#data-disk-for-filing-pdfs)). The database stores only their hash and storage key.

## Where a person decides

Everything a person decides is under **Admin → Company intelligence → Review**:
- **Staging approval**: Approve, Edit & approve, or Reject, one at a time or in bulk. Each item shows a field diff against the last released version and a link to the raw page.
- **Matches**: is this the same company?
- **Conflicts**: the sources disagree; mark it checked or ignore it.
- **Mentions**: is this article about this company?
- **Rejects**: what the clean stage refused.

**Publish review** (`/admin/pipeline`) is the last step: accept field by field what reaches the public profile.

## Jobs

| Group | Jobs |
|---|---|
| registers (`cssf`, `gleif`, `rcs`) | `cssf_census`, `cssf_fetch`, `gleif_sync`, `rcs_*` |
| `web` | `fundhub_sync` (hourly), `website_crawl` (nightly batch of due companies, or one company) |
| `news` | `news_poll` (every 30 minutes), `news_search` (daily batch) |
| `maintenance` | `staging_release`, `build_groups` (daily 14:00, includes manager mandates), `fund_lifecycle` (daily 14:30), `domiciliation_match` (daily 14:45), `quality_run` (daily), `publish_proposals` (daily 16:00), `reprocess`, `retention_purge`, `reclassify` (Mondays), `census_snapshot` |

All schedules are in the daytime (Luxembourg time) because the VM is switched off at night (auto-shutdown 21:30):
- `cssf_census` 10:30;
- `cssf_refresh` 11:00;
- `gleif_sync` 12:00;
- `build_groups` 14:00;
- `website_crawl` 15:00;
- `publish_proposals` 16:00;
- `census_snapshot` and `quality_run` around 17:30.

A job missed while the VM is off runs again at its next slot.

Run any job by hand with `npm run engine -- run <job> [--flag value]`. On the VM, `fundhub-engine-worker` serves the `cssf,gleif,web,news,maintenance` groups and `fundhub-engine-scheduler` keeps the cron schedules.

## Data quality

`quality_run` measures the checks in `ops.quality_checks` and writes the results to `ops.quality_results`, shown on the Data quality page:
- LBR coverage
- cross-checked share (companies stated by 2 or more sources)
- match rate
- open conflicts
- approval backlog
- reject rate
- freshness
- websites known
- websites verified

## Personal data

People are stored with name, title, role, source page and public profile URL only, never photos or private contacts.

Each source can set `retention_days`. `retention_purge` deletes positions older than that limit, and people left without a position. A GDPR erasure deletes the person row, and their positions cascade.

The terms of LinkedIn, Glassdoor and Meta forbid scraping. Before enabling those sources, decide on the method (public pages at human pace, an official API, or a licensed data vendor) and record the GDPR legitimate-interest assessment.

## Setup

```
npm run engine:db:setup                       # migrations (layered baseline) + seed (sources, precedence, policies, feeds, checks)
cp services/engine/.env.example services/engine/.env
#   ENGINE_DATABASE_URL, ANTHROPIC_API_KEY (website source),
#   WEBSITE_DATABASE_URL_RO (fundhub source), WEBSITE_DATABASE_URL_PUBLISH (publish)
ENGINE_RO_DB_PASSWORD=… npm run db:roles      # website DB: creates the read-only fundhub_engine_ro role
npm test -w @fundhub/engine
```
