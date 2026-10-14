# FundHub Lux

B2B directory and price comparator for Luxembourg fund service providers.

**Stack:** Next.js 16 (App Router) · TypeScript · React 19 · Tailwind CSS v4 · Drizzle ORM · libSQL/SQLite (Turso in production) · lucide-react

## Positioning

FundHub is an **independent** comparator and buy-side advisor for Luxembourg fund services. It is paid by asset managers (advisory fees) and never by referral fees or commissions from providers. Provider subscriptions only buy profile control and reports, never ranking, scores or the Verified badge. See `/independence`.

## Features

- **Landing page** (`/`): positioning, the referral-fee problem, how it works, the 8 categories, independence comparison, advisory teaser, live stats.
- **Comparator** (`/compare`): search plus filters for service category, sub-service, headcount, price bounds, provider type, client density, asset class, licence, regulatory scope and tech stack. Card metrics change with the selected category. All filters live in the URL and filtering runs in the database.
- **Service taxonomy** (`/services`, `/services/[category]`): the business plan's 8 macro-categories and standardized sub-services, each with a buyer's guide (when you need it, what to compare, red flags, typical fees). Source of truth: `src/lib/taxonomy.ts`.
- **Provider profiles** (`/providers/[slug]`): services grouped by category, licences, asset classes, certifications, footprint, set-up fee, data sources and last-verified date, fee-audit CTA, similar providers.
- **Independent advisory** (`/advisory`): fee audit, vendor selection/RFP, negotiation advocacy, fund set-up map; conflict-free fee model; consultation form.
- **Request quotes** (`/rfi`): standardized RFI using the taxonomy.
- **For providers** (`/for-providers`): free listing, free verification, Pro tiers (pricing on request), intelligence reports, Market Awards, claim form.
- **Knowledge hub** (`/insights`): articles in `src/content/insights.ts`.
- **Methodology & data** (`/methodology`): metric definitions, data-source governance table, API docs. `/about` redirects here.
- **AI Advisor widget:** rule-based guidance (`src/lib/advisor.ts`) with live provider matches.
- **Forms:** RFI, advisory and provider-claim submissions are stored in `rfi_requests` with `request_type` = `rfi` | `advisory` | `claim` (server action in `src/lib/request-actions.ts`, honeypot spam trap, works without JavaScript).
- **JSON API:** `/api/providers`, `/api/providers/[slug]`, `/api/stats`, `/api/health`, `/api/advisor`.
- **SEO:** `sitemap.xml`, `robots.txt`, icon, per-page metadata.
- **Data pipelines:** import providers from CSV/JSON as *staged*, review them, then publish.

> Provider data in `data/providers.json` is illustrative sample data (fictional names, `example.com` sites).

## Local development

Requires Node.js 20.9+ (22 LTS recommended).

```bash
npm install
cp .env.example .env        # defaults to a local SQLite file, no setup needed
npm run db:setup            # create tables + seed 32 providers and sample RFIs
npm run dev                 # http://localhost:3000
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Next.js dev server / production build / production server |
| `npm run typecheck` | TypeScript check |
| `npm run db:generate` | Generate a new SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations to the database in `DATABASE_URL` |
| `npm run db:seed` | Upsert `data/providers.json` (safe to re-run) |
| `npm run db:setup` | migrate + seed |
| `npm run pipeline:import -- <file.csv\|.json> [--publish] [--dry-run]` | Validate and import providers as staged |
| `npm run pipeline:publish [-- <slug>...] [--list]` | Publish staged providers |

CSV format: see `data/import/sample-providers.csv`. List fields use `|` as the separator. `category` is a taxonomy slug and `services` must use the canonical sub-service names from `src/lib/taxonomy.ts`.

## Deploying to Vercel

Vercel's filesystem is read-only, so production uses a hosted **Turso** database (libSQL, with a free tier) instead of the local SQLite file.

1. **Push the code to GitHub.** The app lives at the repo root.
2. **Create the Vercel project:** vercel.com → *Add New → Project* → import the repo.
   - Framework preset: Next.js (auto-detected). Leave **Root Directory empty** and the build command as default; Vercel runs `vercel-build`, which applies migrations and then builds.
3. **Create the database.** Pick one:
   - **Vercel Marketplace** (easiest): Project → *Storage* → *Turso* → create and connect. This sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` automatically.
   - **Turso CLI:** `turso db create fundhub`, `turso db show fundhub --url`, `turso db tokens create fundhub`, then add `DATABASE_URL` and `DATABASE_AUTH_TOKEN` under Project → *Settings → Environment Variables*.
4. **Deploy.** Migrations run automatically during the build.
5. **Seed production once** from your machine, using the production credentials:
   ```bash
   # PowerShell
   $env:DATABASE_URL="libsql://..."; $env:DATABASE_AUTH_TOKEN="..."; npm run db:seed
   ```
6. Check `https://<your-app>.vercel.app/api/health`. It should return `{"status":"ok","database":"ok"}`.

## Project structure

```
src/
  app/                 routes (pages, API)
  components/          UI components (client components use the URL for filter state)
  content/             insights articles
  db/                  schema, client, env resolution, queries
  lib/                 taxonomy, filters, formatting, advisor engine, request forms, provider validation
scripts/               seed + import/publish pipelines
data/                  seed data and sample import file
drizzle/               generated SQL migrations (commit these)
```
