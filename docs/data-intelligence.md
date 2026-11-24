# Data intelligence (Metabase)

FundHub's reporting platform: a query manager, system reports and user-defined reports over both databases. Underneath it is **Metabase** (open-source edition, AGPL), running on the Azure VM. Its dashboards appear inside the admin console under **Data intelligence**.

| You want to… | Where |
|---|---|
| Look at a report | Admin → Data intelligence → **Reports** (`/admin/intelligence`) |
| Write SQL, build a question or a dashboard | Admin → Data intelligence → **Query workspace**, which opens Metabase at `https://<vm>/bi` |
| Run one quick ad-hoc SQL query | Admin → **Database** → SQL console |
| Add or change a system report | `infra/bi/reports/`, then `npm run bi:provision` (see below) |

## How it fits together

```
 Admin console (Vercel)                         Azure VM (Caddy :443)
 /admin/intelligence ──GET /bi/api/search ─────▶ Metabase 127.0.0.1:3010 ──localhost──▶ Intelligence DB (fundhub_bi_ro, read-only)
   (X-Api-Key, list of dashboards)                 (service fundhub-metabase)     └──TLS──▶ Website DB on Neon (fundhub_analyst_ro)
 /admin/intelligence/<id>                         app DB: Postgres "metabase" (backed up nightly)
   iframe ─────/bi/embed/dashboard/<signed JWT>──▶
 Staff browser ──/bi/ (Authelia 2FA + Metabase login)──▶ query editor, collections, admin
```

- **Viewing** happens in the admin. The console signs a 10-minute token (HS256, `METABASE_EMBED_SECRET`) for exactly one dashboard. Metabase checks the signature, so a viewer can't change the dashboard or its filters. Only dashboards with embedding switched on can be opened, and `owner` is the only role that sees restricted ones. Every view is written to the audit log (`bi.view`).
- **Building** happens in Metabase itself. The free edition can't embed its editor in another site; that's the paid "interactive embedding".
- **Security:**
  - Metabase listens on `127.0.0.1` only. Caddy publishes `/bi`.
  - Without a VM login (Authelia 2FA), only three things are reachable: the signed embed paths, static assets, and the two read-only list endpoints the console calls with its API key.
  - Everything else needs the VM login first, then the person's own Metabase account.
  - Both data sources use read-only roles. `fundhub_bi_ro` is also forced into read-only transactions with a 30-second statement timeout.
  - No database port is opened for this.

## Collections and roles

| Collection | Content | Who sees it in the admin |
|---|---|---|
| **FundHub system reports** | Kept in the repo (`infra/bi/reports/`). Read-only in Metabase: changes made there are overwritten by the next provisioning. | `owner`, `operations`, `analyst`, `sales` (`CAN.bi`) |
| **FundHub restricted reports** | Kept in the repo (Finance). Hidden from non-admin Metabase users. | `owner` only (`CAN.biRestricted`) |
| **Team reports** | Whatever staff build. Everyone can write here. | Everyone with `CAN.bi`, once embedding is switched on for the dashboard |

**Showing your own report in the admin:** in Metabase, open the dashboard → **Sharing** → **Embed** → **Static embedding** → **Publish**. It appears under Data intelligence → Reports → Team reports within 5 minutes. Switching embedding off removes it again.

## System reports

| Dashboard | Database | What it shows |
|---|---|---|
| Pipeline health | Intelligence | Companies, cross-checked share, approval backlog, open conflicts, job runs per day, rows per layer, latest quality checks, failed runs |
| Coverage & completeness | Intelligence | Websites known and verified, linked share, records per source, golden-field completeness, sources per company, coverage table |
| Luxembourg companies | Intelligence | Kinds, status, legal forms, registrations per year, CSSF licences, provider categories, recent changes |
| News & mentions | Intelligence | Articles per week and feed, mentions (pending and accepted), most-mentioned companies, feeds, latest articles |
| FundHub business | Website | Published and claimed providers, reviews, open requests, accounts, requests and reviews per month, categories, best rated |
| Finance (restricted) | Website | Monthly recurring revenue, subscriptions, open invoices, plans, payments per month, expenses vs budget, expenses by category |

### Adding or changing one

Each folder in `infra/bi/reports/` is one dashboard: a `dashboard.json` file (name, description, `database`: `intelligence` / `website`, `collection`: `system` / `restricted`) plus one `.sql` file per chart, placed in file-name order. The header comments set the chart:

```sql
-- name: Registrations per year          (unique within its collection)
-- display: line                         scalar | bar | line | row | pie | table
-- size: 12x6                            width x height on the 24-column grid
-- x: year                               dimension column(s), comma-separated
-- y: companies                          metric column(s)
-- stacked: true                         optional
-- format: percent                       optional, for a column named "share"
select extract(year from registration_date)::int::text as year, count(*) as companies
from core.companies where registration_date is not null group by 1 order by 1
```

Check the SQL first (for example `psql "$(cat ~/.fundhub-secrets/bi-ro-db-url)"`), then run `npm run bi:provision` on the VM. Questions and dashboards are matched by name, so renaming one creates a new one: archive the old one in Metabase. Metabase's own export ("serialization") is paid, so this script is how the system reports stay versioned.

## Setup (once)

1. **VM size:** Metabase needs about 1.5 GB of memory. The VM runs at 8 GB (`D2as_v5`).
2. On the VM: `sudo bash infra/vm/bin/metabase-install.sh`, then `sudo bash infra/vm/install.sh` (Caddy route `/bi`, Authelia rule). The install script:
   - installs Java 21 and Metabase (pinned version and SHA-256);
   - creates the `metabase` application database and the read-only role `fundhub_bi_ro`;
   - writes `/etc/metabase/metabase.env` and `~/.fundhub-secrets/bi-ro-db-url`;
   - starts `fundhub-metabase`.
3. Open `https://<vm>/bi/`. Log in to the VM (2FA), then create the Metabase admin account. Skip "Add your data".
4. In Metabase: **Admin → Settings → Authentication → API keys → Create**. Use the name `fundhub-console`, group *Administrators*. Store the key in your password manager.
5. On the VM, run:
   ```
   METABASE_API_KEY=… ANALYST_DATABASE_URL='postgres://fundhub_analyst_ro:…@…neon.tech/neondb?sslmode=require' npm run bi:provision
   ```
   This:
   - registers both databases;
   - creates the three collections and their permissions;
   - archives Metabase's sample collection;
   - creates the six dashboards;
   - switches on static embedding, with its secret written to `~/.fundhub-secrets/metabase-embed-secret`.
6. On Vercel (`fund-hub-admin`), set these, then redeploy:
   - `METABASE_EMBED_SECRET` = the contents of that file
   - `METABASE_API_KEY` = the key from step 4
   - optionally `METABASE_SITE_URL` (the default is the VM's `/bi`)
7. Staff accounts: each person needs a VM login (`infra/vm/bin/authelia-useradd.sh`) and a Metabase account (Admin → People → Invite). Viewing reports inside the admin needs neither.

## Operations

| | |
|---|---|
| Service | `fundhub-metabase` (`journalctl -u fundhub-metabase -f`), memory cap 2.2 GB, Java heap 1.5 GB |
| Health | `curl 127.0.0.1:3010/api/health`; also checked by `infra/vm/bin/health.sh` |
| Backup | Database `metabase` dumped nightly with `fundhub_engine` (`infra/vm/bin/backup-engine-db.sh`) |
| Upgrade | Change `MB_VERSION` and `MB_SHA256` in `metabase-install.sh`, then re-run it. Metabase migrates its own database on start. |
| Secrets | `/etc/metabase/metabase.env` (application DB password, `MB_ENCRYPTION_SECRET_KEY`: never change it once set, it encrypts the stored data-source passwords) |
| Read-only role | `sudo bash infra/vm/bin/metabase-install.sh --grants` re-applies `fundhub_bi_ro` privileges after new schemas appear |
