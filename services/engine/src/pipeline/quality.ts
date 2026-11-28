/**
 * FILE: services/engine/src/pipeline/quality.ts
 * PART: scraping engine (services/engine) — data quality (ops.quality_checks → ops.quality_results)
 * WHAT IT DOES: Measures each enabled quality check once (job `quality_run`, daily) and stores the value,
 *   numerator / denominator and pass/fail against the check's min / max. The console's Data quality page
 *   shows the latest value and the trend. Adding a check = a row in seed-data.ts QUALITY_CHECKS + a query here.
 * WHERE IT RUNS: engine workers.
 */

import { sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { qualityChecks, qualityResults } from "@fundhub/engine-db/schema";

type Measure = { numerator: number; denominator: number; ratio: boolean };

/** Kind: constant. One SQL per check code, returning numerator (n) and denominator (d). Counts use d = 1. */
const QUERIES: Record<string, { q: ReturnType<typeof sql>; ratio: boolean }> = {
  lbr_coverage: {
    ratio: true,
    q: sql`select (select count(*) from core.companies where rcs_number is not null)::int as n,
                  (select coalesce(sum(max_known), 0) from ops.lbr_number_space where enabled)::int as d`,
  },
  multi_source: { ratio: true, q: sql`select count(*) filter (where source_count >= 2)::int as n, greatest(count(*), 1)::int as d from core.companies` },
  match_rate: {
    ratio: true,
    q: sql`select count(*) filter (where company_id is not null)::int as n, greatest(count(*), 1)::int as d
           from staging.source_records where state = 'found' and source not in ('news', 'manual') and released_parsed_id is not null`,
  },
  filings_truncated: {
    ratio: false,
    q: sql`select count(*)::int as n, 1 as d from (select f.source_record_id from clean.filings f join staging.source_records s on s.id = f.source_record_id
           where s.source = 'rcs' group by 1 having count(*) >= 200 and count(*) % 200 = 0) x`,
  },
  open_conflicts: { ratio: false, q: sql`select count(*)::int as n, 1 as d from match.conflicts where status = 'open'` },
  review_backlog: { ratio: false, q: sql`select count(*)::int as n, 1 as d from staging.parsed_records where review_status = 'pending' and created_at < now() - interval '3 days'` },
  reject_rate: {
    ratio: true,
    q: sql`select (select count(*) from clean.rejects where created_at > now() - interval '7 days')::int as n,
                  greatest((select count(*) from clean.claims where valid_from > now() - interval '7 days'), 1)::int as d`,
  },
  freshness: {
    ratio: true,
    q: sql`select count(*) filter (where next_fetch_at >= now() - interval '2 days')::int as n, greatest(count(*), 1)::int as d
           from staging.source_records where next_fetch_at is not null and state = 'found'`,
  },
  website_completeness: {
    ratio: true,
    q: sql`select count(*) filter (where website is not null)::int as n, greatest(count(*), 1)::int as d from core.companies where is_service_provider and status = 'active'`,
  },
  website_verified: { ratio: true, q: sql`select count(*) filter (where website_verified_at is not null)::int as n, greatest(count(*) filter (where website is not null), 1)::int as d from core.companies` },
};

/** Kind: async function. Measures every enabled check. @returns how many were measured and how many failed. */
export async function runQualityChecks(): Promise<{ measured: number; failed: number }> {
  const checks = await db.select().from(qualityChecks);
  let measured = 0;
  let failed = 0;
  for (const c of checks) {
    if (!c.enabled || !QUERIES[c.code]) continue;
    const { q, ratio } = QUERIES[c.code];
    const [r] = (await db.execute<{ n: number; d: number }>(q)).rows;
    const m: Measure = { numerator: r.n, denominator: r.d, ratio };
    // Nothing to measure against yet (e.g. no LBR number space known): stored as "not measured", never a fake 300%.
    if (ratio && !m.denominator) {
      await db.insert(qualityResults).values({ checkCode: c.code, value: null, numerator: m.numerator, denominator: 0, passed: null });
      continue;
    }
    const value = ratio ? m.numerator / m.denominator : m.numerator;
    const passed = (c.min === null || value >= c.min) && (c.max === null || value <= c.max);
    if (!passed) failed++;
    measured++;
    await db.insert(qualityResults).values({ checkCode: c.code, value, numerator: m.numerator, denominator: m.denominator, passed });
  }
  return { measured, failed };
}
