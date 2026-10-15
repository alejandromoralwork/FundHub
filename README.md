# FundHub

Independent comparator and buy-side advisor for Luxembourg fund services (fundhub.lu).
FundHub is paid by fund managers, never by referral fees or commissions from the providers it compares.

## Architecture: three independent parts, one database

```
apps/web/          Public website (Next.js) at fundhub.lu
apps/admin/        Internal management platform (Next.js + Refine + Ant Design) at fundhub.lu/admin
services/scraper/  Data module (TypeScript): AI web extractor + RCS register adapter, run on GitHub Actions
packages/db/       Postgres schema (Drizzle), migrations, client, shared queries
packages/core/     Taxonomy, enums, filters, formatting, request options, password hashing
packages/email/    React Email templates + Resend sender (logged in email_messages)
infra/             Docker server for the open-source tools: Nextcloud, Twenty, Listmonk (see infra/README.md)
```

The parts only share the Postgres database and the `packages/*` code. Each deploys and fails on its own:

- **Website and admin** are two Vercel projects from this repo (Root Directory `apps/web` and `apps/admin`). The website rewrites `/admin/*` to the admin deployment (Next.js multi-zones), so staff use `fundhub.lu/admin`.
- **Data module** runs on GitHub Actions (`.github/workflows/scrape.yml`): weekly AI web extraction, a daily sweep of jobs queued from the admin, and immediately when staff click "Run scrape" (if `GITHUB_DISPATCH_TOKEN` is set). It writes only to the `ingest_*` staging tables; staff review every field before it reaches a public profile.
- **Database**: Postgres (Neon in production). `npm run db:roles` creates one login role per part (`fundhub_web`, `fundhub_admin`, `fundhub_scraper`, `fundhub_analyst_ro`) so each can only touch what it needs.

## Users

| Who | Where | How |
|---|---|---|
| Visitors | website | No login needed to browse |
| Visitor accounts (fund managers) | website `/account` | Save providers, verified reviews, newsletter |
| Provider accounts | website `/account` | Claim a company → staff approve → edit profile, private reports |
| Staff | `/admin` | Separate accounts, password + mandatory authenticator-app 2FA, roles owner / operations / analyst / sales |

## Business tools

| Area | Where | Notes |
|---|---|---|
| News & Learn, social media | Admin **Content studio** | Write by hand or draft with Claude (facts-only; `[CHECK: …]` notes block publishing), Markdown editor, publish to the website; versions for LinkedIn, X, Facebook, Instagram with copy/CSV export. Postiz auto-posting later. |
| Finance | Admin **Finance** | P&L from paid Stripe invoices + expenses, Luxembourg VAT, budgets, quarterly VAT position, CSV exports for the accountant. Bigcapital later. |
| Legal & GDPR | Website `/legal/*`, `/privacy-request`; admin **GDPR requests** | Cookie consent; data export (JSON) and erasure with one-month deadlines. **Fill in `packages/core/src/company.ts` and have the legal texts reviewed by a Luxembourg lawyer.** |
| Drive, calendar, team tasks | **Nextcloud** (`infra/`) | Linked from the admin sidebar. |
| CRM & pipelines | **Twenty** (`infra/`) | Inbox "Send to CRM". |
| Newsletter | **Listmonk** (`infra/`) | Website footer form and sign-up opt-in, double opt-in. |

> Data location: the Neon database was created in `us-east-1`. Before real customer data, consider moving it to an EU region (Frankfurt) to simplify GDPR transfers.

## Admin platform modules

Dashboard · Moderation (company claims, client reviews, provider self-edits) · Inbox (all form submissions, status, notes, email replies) · Email (compose to a person or segment, delivery log via Resend webhook) · Billing & invoices (Stripe: customers, quarterly Pro subscriptions, advisory invoices, reminders, webhook mirror) · Analytics · Data pipeline (runs, jobs, field-by-field review) · Reports (PDF upload) · Database (every table, generic editor, read-only SQL console) · Staff · Audit log (every staff write).

## Local development

Requires Node.js 20.9+. No Docker needed.

```bash
npm install
npm run db:local            # terminal 1: real Postgres on localhost:5433 (data in packages/db/.pg-data)
npm run db:setup            # terminal 2: migrations + 32 sample providers
npm run staff -w @fundhub/admin -- create you@fundhub.lu "Your Name" owner   # prints a temporary password
npm run dev                 # website on :3000, admin on :3001 (also at localhost:3000/admin)
```

Without `RESEND_API_KEY`, emails are printed to the server console and still logged in the admin Email module.

### Data module

```bash
npm run scrape -- run --source rcs --limit 3          # RCS (mock source until a register provider is chosen)
npm run scrape -- run --source ai_web --provider <slug> --dry-run   # needs ANTHROPIC_API_KEY
npm run scrape -- jobs                                # process jobs queued from the admin
npm test -w @fundhub/scraper
```

The AI extractor uses Claude Opus 5.5 (`claude-opus-5-5`, override with `ANTHROPIC_MODEL`) with a strict JSON schema of FundHub's taxonomy, and the server-side refusal fallback. Page content is treated as untrusted data. Values that already match the live profile are dropped, so only real changes reach review.

The RCS adapter (`services/scraper/src/sources/rcs.ts`) has a `MockRcsClient` that only echoes known data. Add a real client (LBR API or an aggregator) to `CLIENTS` and set `RCS_SOURCE`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `typecheck` | All apps via Turborepo |
| `npm run db:generate` | New migration after editing `packages/db/src/schema.ts` |
| `npm run db:migrate` / `db:seed` / `db:setup` | Apply migrations / upsert sample providers / both |
| `npm run db:roles -w @fundhub/db` | Create per-part Postgres roles (run as owner; re-run after new tables) |
| `npm run db:from-turso -w @fundhub/db` | One-off copy of the old Turso data into Postgres |
| `npm run staff -w @fundhub/admin -- …` | Create staff, reset password or 2FA, list |
| `npm run scrape -- …` | Data module (see above) |

## Deployment

1. **Database:** add Neon from the Vercel Marketplace and connect it to both Vercel projects. Run `npm run db:migrate`, then `db:roles` with the four passwords, and give each part its role's connection string.
2. **Website** (`fund-hub` project, Root Directory `apps/web`): `DATABASE_URL` (fundhub_web role), `ADMIN_ORIGIN` = the admin deployment URL, optional `RESEND_API_KEY`, `EMAIL_FROM`.
3. **Admin** (new project, Root Directory `apps/admin`, build command `npm run vercel-build`, which applies migrations): `DATABASE_URL` (fundhub_admin role), `DATABASE_URL_UNPOOLED`, `ANALYST_DATABASE_URL`, `PUBLIC_SITE_URL`, `RESEND_API_KEY`, `RESEND_WEBHOOK_SECRET`, `EMAIL_FROM`, Stripe keys and price ids, `STRIPE_WEBHOOK_SECRET`, optional `GITHUB_DISPATCH_TOKEN` + `GITHUB_REPO`, `POSTHOG_URL`.
4. **Data module**: GitHub repo secrets `SCRAPER_DATABASE_URL` (fundhub_scraper role) and `ANTHROPIC_API_KEY`; optional variable `RCS_SOURCE`.
5. Create the first staff owner with `npm run staff` against the production database.

See `.env.example` for every variable.

> Provider data in `packages/db/data/providers.json` is illustrative sample data (fictional names, `example.com` sites).
