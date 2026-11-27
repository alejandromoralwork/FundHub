# Data model roadmap: mandates, people flows and fund launches

**Status (27 Nov 2026):**
- **Built:** step 1 (mandates core: schema, exclusion guard, GLEIF manager mandates, staff edits, company-page tab) and step 2 (fund lifecycle, launches, manager momentum, Metabase dashboard).
- **Partly built:** the `positions` time-model columns exist, but no source fills them yet.
- **Not built:** steps 3–5. It extends the Intelligence DB (`packages/engine-db`) after the fund-profile and company-groups work ([data-pipeline.md](data-pipeline.md#fund-profile-and-company-groups)).

## 1. What we want to answer

| Question | Needs |
|---|---|
| Who is the depositary, fund administrator, transfer agent, auditor, ManCo/AIFM, bank… of each fund and sub-fund, **and since when**? | Service mandates with real start and end dates |
| Which fund administrator is **winning or losing** clients, and to whom? | Mandate *switches* (A → B on date D) aggregated by provider group |
| Which people moved from administrator X to Y, and which teams move from Luxembourg to back offices abroad? | Employment history with real dates, employer location and branch, and the moves between employers |
| How many funds does each AIFM / ManCo **launch per quarter**? Who are the new or fast-growing promoters (sales leads)? | Fund lifecycle dates and the manager at launch time |
| Node diagrams: a fund's providers over time; client flows between administrators; talent flows | Everything above as dated edges |

## 2. Design principles

1. **Two timelines, always.** Every fact that changes over time carries:
   - **valid time:** when it was true in the real world (`valid_from` / `valid_to`, plus a `precision`: day, month, year or unknown);
   - **record time:** when we learnt it (`first_seen_at` / `last_seen_at`, plus the source document's date).

   Today `core.company_relations.valid_from` and `core.positions.valid_from` default to *now*, which mixes the two. Switch analysis is impossible without fixing this, so it's the first change (§3.1).
2. **Episodes, not snapshots.** A mandate is one row per continuous period (fund F, role depositary, provider P, 2019-03 → 2024-06). A new provider closes the old episode and opens a new one. Snapshot evidence ("annual report 2022 names P") is kept separately and *supports* episodes.
3. **Evidence first, consolidation second**, the same layers as today: sources state facts → `clean` claims → match → `core` episodes. Each episode lists the evidence behind it and a confidence. Staff can confirm or correct it, and `manual` always wins.
4. **Entities stay in `core.companies`, aggregation goes through groups.** "BNY Mellon" or "Alter Domus" is a *provider group* (already built). League tables and flows are computed per group, at the date of each event.
5. **Derived analytics are views or materialised marts**, never hand-maintained tables:
   - `mart.mandate_switches`
   - `mart.provider_league`
   - `mart.people_moves`
   - `mart.fund_launches`
   - `mart.graph_edges`
6. **Overlaps are blocked by the database:** an exclusion constraint (`btree_gist`) stops two current depositaries for the same fund, while co-administrators are still allowed for roles marked non-exclusive.

## 3. Schema changes

### 3.1 Fix the time model on what exists

| Table | Change |
|---|---|
| `core.company_relations` | Superseded by `core.mandates` (§3.2). Existing rows are migrated: `valid_from` becomes `first_seen_at`, and the real start becomes unknown. |
| `core.positions` | Add `start_date`, `end_date` and `date_precision` (real employment dates), and `observed_from` / `observed_to` (what `valid_from` / `valid_to` mean today). Also add `location_country`, `location_city`, `function`, `seniority` and `employment_type`, plus `employer_entity_id` when the person works for a *specific* entity (for example a Polish service centre) rather than the group. |
| `core.companies` | Add `jurisdiction` (ISO country, default LU) and `register_scope` (`lu_rcs`, `lu_unregistered`, `foreign`), so foreign branches, parents and back-office centres can be companies too. Add `launch_date`, `launch_date_source`, `closure_date` and `closure_reason` for funds (§3.4). |

### 3.2 Service mandates: who serves which fund, over time

```sql
-- Reference: what roles exist and how they behave.
create table ops.mandate_roles (
  code text primary key,            -- depositary, central_administration, transfer_agent, registrar, auditor,
                                    -- management_company, aifm, investment_manager, investment_adviser, distributor,
                                    -- domiciliation_agent, paying_agent, legal_adviser, prime_broker, listing_agent, director…
  label text not null,
  exclusive boolean not null,       -- one at a time per fund (depositary, auditor, ManCo/AIFM, central admin)
  regulated boolean not null,       -- CSSF-licensed role
  applies_to text not null          -- 'fund' | 'sub_fund' | 'both'
);

-- One row per continuous period of one provider serving one fund (or sub-fund) in one role.
create table core.mandates (
  id bigserial primary key,
  client_company_id uuid not null references core.companies on delete cascade,   -- fund / sub-fund / vehicle
  provider_company_id uuid references core.companies on delete set null,         -- the legal entity, when matched
  provider_name text not null,                                                   -- as the evidence writes it
  role text not null references ops.mandate_roles,
  valid_from date, valid_from_precision text not null default 'unknown',         -- day | month | year | unknown
  valid_to date,   valid_to_precision text,                                       -- null = current
  status text not null default 'current',     -- current | ended | announced | disputed
  confidence real not null default 1,
  decided_by text,                             -- 'engine' | 'staff:<email>'
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  period daterange generated always as (daterange(valid_from, valid_to, '[)')) stored,
  exclude using gist (client_company_id with =, role with =, period with &&)
    where (status in ('current','ended') and role in ('depositary','auditor','management_company','aifm','central_administration'))
);

-- What supports each mandate (several documents over the years).
create table core.mandate_evidence (
  id bigserial primary key,
  mandate_id bigint not null references core.mandates on delete cascade,
  source text not null,                        -- engine source code
  source_record_id bigint references staging.source_records,
  document_sha256 text,                        -- raw.documents (annual report, prospectus PDF)
  document_date date,                          -- "as stated on" date: the key to dating switches
  url text, quote text,                        -- short excerpt, e.g. "Depositary: … S.A."
  claim_id bigint references clean.claims
);
```

**How a switch is detected:**
- The consolidation stage sorts a fund's dated evidence per role.
- When the stated provider changes, it ends the open episode. The end date is the best estimate between the last document naming A and the first naming B, with the precision widened accordingly.
- It writes `core.changes` events: `mandate_started`, `mandate_ended`, `mandate_switched`.

**`mart.mandate_switches`** has one row per switch: fund, sub-fund, role, from provider and its group, to provider and its group, the date and its precision, and the fund's regime, law and manager. That gives:
- a **league table** per role and period: gained, lost and net, per provider group;
- **Sankey / node data**, directly.

### 3.3 People and employment flows

```sql
alter table core.people add column linkedin_url text unique, add column location_country text,
  add column headline text, add column lawful_basis text not null default 'legitimate_interest',
  add column erase_after date;

-- Positions get real dates and place (see 3.1); one row per job episode.

create view mart.people_moves as            -- consecutive jobs of the same person
select p.person_id,
       a.company_id as from_company, ga.group_id as from_group, a.location_country as from_country, a.function as from_function,
       b.company_id as to_company,   gb.group_id as to_group,   b.location_country as to_country, b.function as to_function,
       coalesce(b.start_date, a.end_date) as moved_on
from …   -- window over positions ordered by start_date; groups resolved at the move date
```

These marts follow from it:
- **`mart.talent_flows`**: provider group → provider group, per quarter: movers, by function and seniority.
- **`mart.offshoring_flows`**: same group, Luxembourg → another country. This shows back-office build-up, for example an administrator's Luxembourg fund-accounting team shrinking while its Porto or Kraków centre grows.
- **`core.company_locations`**: company, country, city, type (`hq`, `branch`, `service_centre`, `back_office`), opened and closed dates, and a headcount estimate with its date. Each provider's international footprint, over time.

**GDPR**, since this is LinkedIn data about identifiable people:
- Collect only public profile data: name, title, employer, dates and location.
- Record a legitimate-interest assessment.
- Analytics read **aggregates only** (flows by group, function and quarter). Individual moves show only in the staff console.
- `erase_after` drives retention, and the existing `erase_person` job handles erasure requests.
- LinkedIn's terms forbid scraping, so use an official API or a licensed people-data vendor.

### 3.4 Fund lifecycle and launches

| Fact | Best source | Notes |
|---|---|---|
| Authorisation / registration with the CSSF | CSSF `dtAuthorisation`, `dtInscript`, `dtDebValid` | Already in claims (`cssfAuthorisationDate`, `cssfValidFrom`) |
| Sub-fund launch | CSSF compartment start date (`clean.licences.start_date`) | Gives a launch timeline per umbrella |
| Incorporation | LBR registration date | RAIFs and unregulated SCSps have no CSSF date |
| LEI registration | GLEIF `initialRegistrationDate` | Often near the launch; a fallback |
| Closure / liquidation | CSSF end date, LBR struck off or in liquidation | |
| Manager at launch | `core.mandates` role `aifm` / `management_company` at the launch date | GLEIF `IS_FUND-MANAGED_BY` gives the current manager plus its own relationship dates |

```sql
create table core.fund_events (
  id bigserial primary key,
  company_id uuid not null references core.companies on delete cascade,
  kind text not null,   -- authorised | incorporated | launched | sub_fund_added | renamed | merged_into |
                        -- manager_changed | redomiciled_in | redomiciled_out | in_liquidation | closed
  event_date date, date_precision text not null default 'day',
  related_company_id uuid references core.companies,   -- merged into X, new manager Y…
  source text not null, evidence text
);
```

- **`mart.fund_launches`**: month, manager group, regime, law, legal vehicle, and the count of funds and sub-funds launched.
- **`mart.manager_momentum`**: launches in the last 12 months against the previous 12, per AIFM / ManCo. Promoters with rising launches, or AIFMs newly registered with the CSSF, become a **lead list**, with the providers they use (or "unknown", itself a lead).

### 3.5 Fund facts over time (optional, as data arrives)

- **`core.share_classes`**: ISIN, sub-fund, currency, launch date, distribution policy. GLEIF publishes a daily ISIN ↔ LEI mapping file that links ISINs to sub-funds for free.
- **`core.fund_metrics`**: company, metric (AUM, NAV, number of share classes, number of investors), value, currency, as-of date, source. This allows "assets serviced" league tables, not only counts.
- **`core.provider_services`**: which roles a provider offers, since when, and from which source. This complements the CSSF licences.

## 4. Where the data will come from

| Data | Source | How |
|---|---|---|
| Depositary, administrator, transfer agent, auditor, ManCo per fund **with document dates** | **Annual reports and prospectuses**: filed at LBR (fund accounts) or published by the funds | The existing `documents` and AI extraction path: PDF → Claude with a strict schema (role, provider name, "as at" date, quote) → `clean.mandate_claims` → mandates. Each year's report gives one dated observation, and the switches fall out. |
| Auditor | LBR annual-account filings ("réviseur d'entreprises agréé") | Parse from the filing metadata or the PDF |
| Fund manager | GLEIF `IS_FUND-MANAGED_BY` (with relationship periods) and the CSSF | Already loaded daily |
| Service providers declared by funds or providers | FundHub accounts (self-declared client lists) and provider websites | Existing `fundhub` and `website` sources, with role and date when stated |
| People and jobs | LinkedIn through an official API or a licensed vendor, plus company websites (team pages) | New `linkedin` source adapter, already registered in `ops.sources` (disabled) |
| Provider locations abroad | GLEIF branches, provider websites, LinkedIn company pages | `core.company_locations` |
| Fund launches | CSSF, LBR, GLEIF dates | Mostly already collected; derive `fund_events` |
| ISINs | GLEIF ISIN–LEI file | Daily bulk download, like the relationship file |

## 5. Visualisation

- **`mart.graph_edges`**: `from_id`, `to_id`, `from_type`, `to_type`, `edge_type` (mandate role, employment, group membership, switch) and `period`. It's one generic edge list for every diagram.
- **Metabase:** Sankey charts (native since Metabase 50) for administrator → administrator client flows and talent flows, plus league tables and launch time series.
- **Admin console:** an interactive network view (Cytoscape.js or D3) of one fund's providers over time, a provider's client wins and losses, and a person's career path, with a time slider.
- A graph database isn't needed: recursive SQL and the edge view are enough at Luxembourg scale (hundreds of thousands of edges). Apache AGE (a Postgres extension) can be added later if graph queries get complex.

## 6. Build order

1. **Time-model fix and mandates core:**
   - `ops.mandate_roles`, `core.mandates`, `core.mandate_evidence`; migrate `company_relations`;
   - mandate events in `core.changes`;
   - admin: a fund's "Service providers" tab with its timeline, and staff edits.
2. **Fund lifecycle:** `core.fund_events` from the CSSF, LBR and GLEIF dates already collected; `mart.fund_launches`, `mart.manager_momentum`; Metabase "Fund launches" dashboard.
3. **Mandates from documents:**
   - AI extraction of service providers from annual reports and prospectuses (filings already captured from LBR);
   - consolidation into episodes; `mart.mandate_switches` and the league tables;
   - Metabase "Provider wins & losses" with a Sankey.
4. **People:**
   - positions time-model fix, `core.company_locations`;
   - the LinkedIn source (vendor or API decision plus the GDPR assessment first);
   - `mart.people_moves`, `talent_flows`, `offshoring_flows`.
5. **Graph views** in the admin, and the share-class and metrics tables as data sources allow.
