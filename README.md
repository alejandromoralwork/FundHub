# FundHub

B2B directory and price comparator for Luxembourg fund service providers.

**Stack:** Next.js 16 (App Router) · TypeScript · React 19 · Tailwind CSS v4 · Drizzle ORM · libSQL/SQLite (Turso in production) · pdf-lib · Fontsource (self-hosted fonts) · lucide-react

## Positioning

FundHub is an **independent** comparator and buy-side advisor for Luxembourg fund services. It is paid by asset managers (advisory fees) and never by referral fees or commissions from providers. Provider subscriptions only buy profile control and reports, never ranking, scores or the Verified badge. See `/independence`.

## Sections

| Section | Route | What it is |
|---|---|---|
| Provider Comparator | `/compare` | Filter providers by category, sub-service, licence, asset class, stack, size, fees |
| Service Categories | `/services`, `/services/[category]` | The 8-category taxonomy with buyer's guides |
| Fee Benchmarks | `/benchmarks` | Typical fee ranges by category and provider size |
| Advisory | `/advisory` | We accompany clients to negotiate fees and help them set up their activities |
| News & Learn | `/news` | Sector news and educational guides (`src/content/insights.ts`) |
| Data Intelligence | `/data-intelligence` | Live stats, quarterly PDF reports (public + private), bespoke data services |
| FundHub Awards | `/awards` | Award categories, scoring, timeline, nominations |

Also: provider profiles (`/providers/[slug]`) with verified client reviews, Request quotes (`/rfi`), Independence charter, Methodology & data, For service providers.

## Users

- **Visitors** need no login for anything public.
- **Provider accounts** (`/account/signup`): claim a company listing → a FundHub admin approves → the provider edits its factual profile data (live immediately, every edit logged). Fees, peer scores, reviews, the Verified badge, name and primary category stay FundHub-controlled. Approved accounts can download private reports.
- **Admins** (`/admin`): approve claims (and create new listings), verify client reviews, upload/manage PDF reports, see all form submissions.

Passwords are hashed with scrypt; sessions are random tokens stored hashed in the database (30 days, httpOnly cookie). There is no email service yet, so admins reset passwords with the CLI:

```bash
npm run admin -- create-admin you@fundhub.lu "Your Name"   # prints a temporary password
npm run admin -- reset-password someone@provider.lu
npm run admin -- promote someone@fundhub.lu
npm run admin -- list
```
Point `DATABASE_URL`/`DATABASE_AUTH_TOKEN` at the Turso database to run these against production.

## Verified client reviews

Anyone can submit a review at `/providers/[slug]/review` with a work email, role, relationship and evidence. Automatic checks block the provider's own staff (email domain = provider website, or provider account holders) and flag personal email domains. An admin contacts the reviewer, then publishes or rejects. Published reviews show only role, relationship and fund type; the overall score is folded into the Peer Opinion Score.

## Data Intelligence reports

Two built-in reports are generated as PDFs from live data (`src/lib/report-pdf.ts`): the public **Market Snapshot** and the private **Provider Intelligence Report**. Admins can upload more PDFs (≤ 4 MB, public or private) on `/admin`; they are stored in the database and private ones are only served to approved provider accounts.

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
