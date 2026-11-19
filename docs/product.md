# Product

What FundHub offers and who uses which part. FundHub is an independent comparator of fund service providers in Luxembourg, plus fund set-up and fee-negotiation advisory (fundhub.lu). **It is paid by fund managers, never by referral fees or commissions from the providers it compares.**

## Users

| Who | Where | How |
|---|---|---|
| Visitors | Website | Browse, search, compare without an account |
| Visitor accounts (fund managers) | Website `/account` | Save providers, verified reviews, newsletter |
| Provider accounts | Website `/account` | Claim a company → staff approve → edit the profile, private reports |
| Staff | `/admin` | Separate accounts, password + mandatory authenticator-app 2FA; roles owner / operations / analyst / sales |

## Website features

Provider search and filters by service category, provider profiles, side-by-side compare, the **FundHub Score** and its methodology, benchmarks, awards, verified client reviews, company claims, RFI (request for information) to several providers, **Data Intelligence** (market reports, membership), advisory (fund set-up), news and learn articles, an AI advisor widget, legal pages with cookie consent, and GDPR requests (export / erasure).

## Admin console modules

| Area | Modules |
|---|---|
| Moderation | Company claims, client reviews, provider self-edits |
| Communication | Inbox (all form submissions, status, notes, replies), Email (to a person or segment; delivery log via Resend webhook), Content studio (News & Learn, social versions) |
| Money | Billing & invoices (Stripe customers, quarterly Pro subscriptions, advisory invoices, reminders), Finance (P&L, Luxembourg VAT, budgets, CSV for the accountant) |
| Data | Data pipeline (runs, jobs, field-by-field review), Scraping engine (overview, registry, jobs, match review, capture rounds), Reports (PDF upload), Database (every table, editor, read-only SQL) |
| Workspace | Drive (internal files), Analytics |
| Control | GDPR requests, Staff, Audit log (every staff write) |

## Business tools

| Area | Where | Notes |
|---|---|---|
| News, Learn, social media | Admin **Content studio** | Write by hand or draft with Claude (facts only; `[CHECK: …]` notes block publishing), Markdown editor, publish to the website; versions for LinkedIn, X, Facebook, Instagram with copy / CSV export. Postiz auto-posting later |
| Finance | Admin **Finance** | P&L from paid Stripe invoices + expenses, VAT, budgets, quarterly VAT position, CSV exports. Bigcapital later |
| Legal and GDPR | Website `/legal/*`, `/privacy-request`; admin **GDPR requests** | Cookie consent; export (JSON) and erasure with one-month deadlines. **Fill in `packages/core/src/company.ts` and have the legal texts reviewed by a Luxembourg lawyer** |
| Internal files | Admin **Drive** | Self-hosted file drive on the VM ([operations.md](operations.md#4-drive)) |
| Drive, calendar, team tasks | **Nextcloud** (`infra/tools/`) | Optional; linked from the admin sidebar |
| CRM and pipelines | **Twenty** (`infra/tools/`) | Inbox "Send to CRM" |
| Newsletter | **Listmonk** (`infra/tools/`) | Website footer form and sign-up opt-in, double opt-in |
| Code | **code-server** on the VM | Sidebar link for owners |

> Provider data in `packages/db/data/providers.json` is illustrative sample data (fictional names, `example.com` sites).
