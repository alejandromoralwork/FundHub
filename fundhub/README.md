# FundHub Lux

B2B directory and price comparator for Luxembourg fund service providers.

**Stack:** Next.js 16 (App Router) · TypeScript · React 19 · Tailwind CSS v4 · Drizzle ORM · libSQL/SQLite (Turso in production) · lucide-react

## Features

- **Comparator grid** (`/`): search, macro-category, headcount, tech stack, price bounds, provider type, client density, regulatory scope and sort. All filters live in the URL, so any view can be shared, and filtering runs in the database.
- **Ecosystem stats:** indexed providers, active RFIs, average fee deviation (matched set vs. market) and verified count, all computed live.
- **Provider profiles** (`/providers/[slug]`): services, stack, coverage, key facts, price vs. market, similar providers.
- **RFI requests** (`/rfi`): validated form (server action), stored in the database. Works without JavaScript and has a honeypot spam trap.
- **Fee benchmarks** (`/benchmarks`): ranges by category and provider type.
- **AI Advisor widget:** rule-based guidance on RAIF, UCITS, AML, tax, SFDR, AIFMD and more, with live provider matches from the database. It can be swapped for an LLM later via `src/lib/advisor.ts`.
- **JSON API:** `/api/providers`, `/api/providers/[slug]`, `/api/stats`, `/api/health`, `/api/advisor` (documented at `/about`).
- **Data pipelines:** import providers from CSV/JSON as *staged*, review them, then publish.

## Local development

Requires Node.js 20.9+ (22 LTS recommended).

```bash
npm install
cp .env.example .env        # defaults to a local SQLite file, no setup needed
npm run db:setup            # create tables + seed 22 providers and sample RFIs
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

CSV format: see `data/import/sample-providers.csv`. List fields use `|` as the separator.

## Deploying to Vercel

Vercel's filesystem is read-only, so production uses a hosted **Turso** database (libSQL, with a free tier) instead of the local SQLite file.

1. **Push the code to GitHub.** The repo root is the `FundHub` folder and the app lives in `fundhub/`.
2. **Create the Vercel project:** vercel.com → *Add New → Project* → import the repo.
   - **Root Directory:** `fundhub` (important)
   - Framework preset: Next.js (auto-detected). Leave the build command as default; Vercel runs `vercel-build`, which applies migrations and then builds.
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
  app/                 routes (pages, API, server actions)
  components/          UI components (client components use the URL for filter state)
  db/                  schema, client, env resolution, queries
  lib/                 filters, formatting, advisor engine, provider validation
scripts/               seed + import/publish pipelines
data/                  seed data and sample import file
drizzle/               generated SQL migrations (commit these)
```
