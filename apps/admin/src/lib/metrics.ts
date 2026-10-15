import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@fundhub/db/client";

const one = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute<T>(q)).rows[0]!;
const many = async <T extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute<T>(q)).rows;

export async function getDashboard() {
  const [counts, freshness, recent] = await Promise.all([
    one<{
      pending_claims: number;
      pending_reviews: number;
      open_requests: number;
      requests_30d: number;
      visitors_30d: number;
      providers_30d: number;
      accounts: number;
      providers_published: number;
      providers_verified: number;
      pending_ingest: number;
      mrr_cents: number;
      unpaid_cents: number;
      downloads_30d: number;
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
        (select count(*) from report_downloads where created_at > now() - interval '30 days')::int as downloads_30d`),
    many<{ source: string; last_success: string | null; last_status: string | null }>(sql`
      select s.source,
             (select max(finished_at) from ingest_runs r where r.source = s.source and r.status = 'succeeded') as last_success,
             (select status from ingest_runs r where r.source = s.source order by started_at desc limit 1) as last_status
      from (values ('ai_web'), ('rcs')) as s(source)`),
    many<{ id: number; action: string; entity: string; entity_id: string | null; created_at: string; staff: string | null }>(sql`
      select a.id, a.action, a.entity, a.entity_id, a.created_at, s.name as staff
      from audit_log a left join staff_users s on s.id = a.staff_user_id
      order by a.created_at desc limit 8`),
  ]);
  return { counts, freshness, recent };
}

/** Weekly series for the analytics module (last 12 weeks). */
export async function getAnalytics() {
  const [requests, signups, downloads, categories, revenue, reviews] = await Promise.all([
    many<{ week: string; rfi: number; advisory: number; data: number; awards: number }>(sql`
      select to_char(w.week, 'YYYY-MM-DD') as week,
        count(r.*) filter (where r.request_type = 'rfi')::int as rfi,
        count(r.*) filter (where r.request_type = 'advisory')::int as advisory,
        count(r.*) filter (where r.request_type = 'data')::int as data,
        count(r.*) filter (where r.request_type = 'awards')::int as awards
      from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as w(week)
      left join rfi_requests r on date_trunc('week', r.created_at) = w.week
      group by w.week order by w.week`),
    many<{ week: string; visitor: number; provider: number }>(sql`
      select to_char(w.week, 'YYYY-MM-DD') as week,
        count(u.*) filter (where u.account_type = 'visitor')::int as visitor,
        count(u.*) filter (where u.account_type = 'provider')::int as provider
      from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') as w(week)
      left join users u on date_trunc('week', u.created_at) = w.week
      group by w.week order by w.week`),
    many<{ report: string; downloads: number }>(sql`
      select report_slug as report, count(*)::int as downloads from report_downloads
      where created_at > now() - interval '90 days' group by report_slug order by downloads desc limit 10`),
    many<{ category: string; providers: number; verified: number }>(sql`
      select category, count(*)::int as providers, count(*) filter (where verified)::int as verified
      from providers where status = 'published' group by category order by providers desc`),
    many<{ month: string; paid: number }>(sql`
      select to_char(m.month, 'YYYY-MM') as month, coalesce(sum(i.amount_paid), 0)::int as paid
      from generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') as m(month)
      left join invoices i on i.status = 'paid' and date_trunc('month', i.updated_at) = m.month
      group by m.month order by m.month`),
    many<{ status: string; n: number }>(sql`select status, count(*)::int as n from reviews group by status`),
  ]);
  return { requests, signups, downloads, categories, revenue, reviews };
}
