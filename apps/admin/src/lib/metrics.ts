/**
 * FILE: apps/admin/src/lib/metrics.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Gathers the numbers for the Console's home dashboard (work waiting for staff, recent growth,
 *   revenue, data freshness, latest audit entries) and the weekly/monthly series for the Analytics page.
 * WHERE IT RUNS: only on the server (Node.js), because it queries the database.
 * FRAMEWORK NOTES: `import "server-only"` makes the build fail if browser code ever imports this file, keeping
 *   database access on the server. The dashboard and analytics pages are server components that call these
 *   functions while they render.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - generic functions `<T extends Record<string, unknown>>`: `T` is a placeholder type chosen by each caller
 *     (here: the shape of a result row); `extends` limits it to object-like types.
 *   - `ReturnType<typeof sql>`: "whatever type the `sql` function returns" (a SQL query object).
 *   - non-null assertion `!`: tells TypeScript "trust me, this is not undefined".
 *   - `async` arrow functions, `Promise.all`, array destructuring, union `string | null`.
 */

// Side-effect import: the server-only guard (exports nothing).
import "server-only";
// `import { a } from "b"` brings in a named export. `sql` (Drizzle ORM) writes raw SQL safely.
import { sql } from "drizzle-orm";
// The shared database connection (our packages/db package).
import { db } from "@fundhub/db/client";

/**
 * Kind: constant holding a generic async arrow function.
 * Runs a SQL query and returns its first row, typed as `T`. Used for queries that always give exactly one row.
 * @param q  `ReturnType<typeof sql>` — a query built with `sql\`…\``.
 * @returns  `Promise<T>`. The `!` asserts that row 0 exists (true for "select (…) as a, (…) as b" queries).
 */
const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute<T>(q)).rows[0]!;
/**
 * Kind: constant holding a generic async arrow function.
 * Same as `one` but returns all rows: `Promise<T[]>` (an array of `T`).
 */
const many = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute<T>(q)).rows;

/**
 * Kind: async function.
 * Collects everything for the dashboard home page in three parallel queries.
 * @returns `Promise<{ counts, freshness, recent }>`:
 *   - `counts`: one object of headline numbers (see the type below);
 *   - `freshness`: for each data source, when its import last succeeded and the latest run's status;
 *   - `recent`: the 8 newest audit-log entries with the staff member's name.
 */
export async function getDashboard() {
  const [counts, freshness, recent] = await Promise.all([
    // `one<{ … }>` fills in `T` with this object type, so TypeScript knows every field and its type.
    // Each field is a single number computed by its own small sub-query in the SQL below.
    one<{
      // Queues waiting for staff action.
      pending_claims: number;
      pending_reviews: number;
      open_requests: number;
      // Activity in the last 30 days.
      requests_30d: number;
      visitors_30d: number;
      providers_30d: number;
      // Totals.
      accounts: number;
      providers_published: number;
      providers_verified: number;
      // Scraped records awaiting review in the data pipeline.
      pending_ingest: number;
      // Money, in cents: monthly recurring revenue and unpaid open invoices.
      mrr_cents: number;
      unpaid_cents: number;
      downloads_30d: number;
      // Open GDPR requests and the soonest legal deadline (`string | null`: null when there are none).
      gdpr_open: number;
      gdpr_next_due: string | null;
      post_drafts: number;
    }>(sql`
      select
        (select count(*) from provider_claims where status = 'pending')::int as pending_claims,
        (select count(*) from reviews where status = 'pending')::int as pending_reviews,
        (select count(*) from rfi_requests where status in ('open', 'in_progress'))::int as open_requests,
        (select count(*) from rfi_requests where created_at > now() - interval '30 days')::int as requests_30d,
        (select count(*) from users where account_type = 'visitor' and created_at > now() - interval '30 days')::int as visitors_30d,
        (select count(*) from users where account_type = 'provider' and created_at > now() - interval '30 days')::int as providers_30d,
        (select count(*) from users)::int as accounts,
        (select count(*) from providers where status = 'published')::int as providers_published,
        (select count(*) from providers where status = 'published' and verified)::int as providers_verified,
        (select count(*) from ingest_records where status = 'pending')::int as pending_ingest,
        (select coalesce(sum(case interval when 'quarter' then amount / 3 when 'year' then amount / 12 else amount end), 0)
           from subscriptions where status in ('active', 'trialing', 'past_due'))::int as mrr_cents,
        (select coalesce(sum(amount_due - amount_paid), 0) from invoices where status = 'open')::int as unpaid_cents,
        (select count(*) from report_downloads where created_at > now() - interval '30 days')::int as downloads_30d,
        (select count(*) from gdpr_requests where status in ('received', 'verifying'))::int as gdpr_open,
        (select min(due_at) from gdpr_requests where status in ('received', 'verifying')) as gdpr_next_due,
        (select count(*) from posts where status = 'draft')::int as post_drafts`),
    // Data freshness for the two sources ('ai_web' = AI-assisted web research, 'rcs' = the Luxembourg business
    // register). `values (…) as s(source)` makes a tiny two-row table inline so both always appear.
    many<{ source: string; last_success: string | null; last_status: string | null }>(sql`
      select s.source,
             (select max(finished_at) from ingest_runs r where r.source = s.source and r.status = 'succeeded') as last_success,
             (select status from ingest_runs r where r.source = s.source order by started_at desc limit 1) as last_status
      from (values ('ai_web'), ('rcs')) as s(source)`),
    // Latest 8 audit entries. `left join` keeps an entry even if its staff user no longer exists (name = null).
    many<{ id: number; action: string; entity: string; entity_id: string | null; created_at: string; staff: string | null }>(sql`
      select a.id, a.action, a.entity, a.entity_id, a.created_at, s.name as staff
      from audit_log a left join staff_users s on s.id = a.staff_user_id
      order by a.created_at desc limit 8`),
  ]);
  // Shorthand `{ counts }` means `{ counts: counts }`.
  return { counts, freshness, recent };
}

/**
 * Kind: async function.
 * Weekly series for the analytics module (last 12 weeks).
 * In the SQL, `generate_series(…)` produces every week (or month) in the range, and a `left join` attaches the
 * matching rows, so weeks with zero activity still show as 0 instead of disappearing from the chart.
 * `count(…) filter (where …)` counts only the rows meeting that condition.
 * @returns `Promise<{ requests, signups, downloads, categories, revenue, reviews }>` — arrays ready for charts.
 */
export async function getAnalytics() {
  const [requests, signups, downloads, categories, revenue, reviews] = await Promise.all([
    // Requests per week, split by request type.
    many<{ week: string; rfi: number; advisory: number; data: number; awards: number }>(sql`
      select to_char(w.week, 'YYYY-MM-DD') as week,
        count(r.*) filter (where r.request_type = 'rfi')::int as rfi,
        count(r.*) filter (where r.request_type = 'advisory')::int as advisory,
        count(r.*) filter (where r.request_type = 'data')::int as data,
        count(r.*) filter (where r.request_type = 'awards')::int as awards
      from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as w(week)
      left join rfi_requests r on date_trunc('week', r.created_at) = w.week
      group by w.week order by w.week`),
    // New accounts per week: visitors versus providers.
    many<{ week: string; visitor: number; provider: number }>(sql`
      select to_char(w.week, 'YYYY-MM-DD') as week,
        count(u.*) filter (where u.account_type = 'visitor')::int as visitor,
        count(u.*) filter (where u.account_type = 'provider')::int as provider
      from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as w(week)
      left join users u on date_trunc('week', u.created_at) = w.week
      group by w.week order by w.week`),
    // Top 10 most downloaded reports over the last 90 days.
    many<{ report: string; downloads: number }>(sql`
      select report_slug as report, count(*)::int as downloads from report_downloads
      where created_at > now() - interval '90 days' group by report_slug order by downloads desc limit 10`),
    // Published providers per category, and how many of them are verified.
    many<{ category: string; providers: number; verified: number }>(sql`
      select category, count(*)::int as providers, count(*) filter (where verified)::int as verified
      from providers where status = 'published' group by category order by providers desc`),
    // Money received per month over the last 12 months (cents, including VAT, unlike the Finance page).
    many<{ month: string; paid: number }>(sql`
      select to_char(m.month, 'YYYY-MM') as month, coalesce(sum(i.amount_paid), 0)::int as paid
      from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') as m(month)
      left join invoices i on i.status = 'paid' and date_trunc('month', i.updated_at) = m.month
      group by m.month order by m.month`),
    // How many reviews are in each status (pending / approved / rejected).
    many<{ status: string; n: number }>(sql`select status, count(*)::int as n from reviews group by status`),
  ]);
  return { requests, signups, downloads, categories, revenue, reviews };
}
