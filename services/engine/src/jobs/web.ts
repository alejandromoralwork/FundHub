/**
 * FILE: services/engine/src/jobs/web.ts
 * PART: scraping engine (services/engine) — jobs of the "web" group
 * WHAT IT DOES:
 *   - fundhub_sync: every FundHub listing and approved unlisted account claim → source "fundhub" (each held
 *     at the staging gate for a person by default), then links companies to their listing
 *     (core.companies.website_provider_id), which is what the publish stage uses.
 *   - website_crawl: with `companyId`, crawls that company's website (AI extraction → source "website");
 *     without, queues the companies due for a crawl: those with a website that are followed (tier ≥ 1,
 *     service providers, FundHub listings) and were never crawled or whose refresh date passed.
 * WHERE IT RUNS: engine workers (group "web").
 */

import { sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { finishRun, startRun } from "../core/ops";
import { log } from "../log";
import { ingest } from "../pipeline/ingest";
import type { JobContext } from "./context";

/** Kind: async function. Job "fundhub_sync". */
export async function fundhubSync(data: { since?: string; limit?: number }, ctx: JobContext) {
  const runId = await startRun("fundhub", "fundhub_sync", ctx.trigger, data);
  const stats: Record<string, number> = { seen: 0, new: 0, changed: 0, unchanged: 0, held: 0, not_found: 0, gone: 0, failed: 0, linked: 0 };
  try {
    const raws = await ctx.fundhub.listAll(data);
    for (const raw of raws) {
      stats.seen++;
      try {
        const res = await ingest(ctx.fundhub, raw, { blobs: ctx.blobs, runId });
        stats[res.status] = (stats[res.status] ?? 0) + 1;
      } catch (err) {
        stats.failed++;
        log.warn("fundhub record failed", { id: raw.externalId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    // Link companies to their listing once a released FundHub record points at them.
    const linked = await db.execute(sql`
      update core.companies c set website_provider_id = split_part(r.external_id, ':', 2)::int
      from staging.source_records r
      where r.source = 'fundhub' and r.external_id like 'provider:%' and r.company_id = c.id and r.state = 'found'
        and c.website_provider_id is distinct from split_part(r.external_id, ':', 2)::int`);
    stats.linked = linked.rowCount ?? 0;
    await finishRun(runId, "succeeded", stats);
  } catch (err) {
    await finishRun(runId, "failed", stats, String(err));
    throw err;
  }
  return stats;
}

/** Kind: async function. Job "website_crawl". */
export async function websiteCrawl(data: { companyId?: string; limit?: number }, ctx: JobContext) {
  if (!data.companyId) {
    const due = (
      await db.execute<{ id: string }>(sql`
        select c.id from core.companies c
        left join staging.source_records r on r.source = 'website' and r.company_id = c.id
        where c.website is not null and c.status <> 'struck_off'
          and (c.tier >= 1 or c.is_service_provider or c.website_provider_id is not null)
          and (r.id is null or r.next_fetch_at is null or r.next_fetch_at <= now())
        order by (r.id is null) desc, c.tier desc, c.is_service_provider desc, r.next_fetch_at nulls first
        limit ${data.limit ?? ctx.cfg.website.batch}`)
    ).rows;
    for (const c of due) await ctx.enqueue("website_crawl", { companyId: c.id }, { singletonKey: `website:${c.id}` });
    return { queued: due.length };
  }
  const [c] = (
    await db.execute<{ id: string; canonical_name: string; rcs_number: string | null; website: string | null }>(sql`select id, canonical_name, rcs_number, website from core.companies where id = ${data.companyId}`)
  ).rows;
  if (!c?.website) return { status: "no_website" };
  const runId = await startRun("website", "website_crawl", ctx.trigger, data);
  try {
    const raw = await ctx.website.fetchFor({ id: c.id, name: c.canonical_name, rcsNumber: c.rcs_number, website: c.website });
    if (!raw) {
      await finishRun(runId, "succeeded", { pages: 0 });
      return { status: "no_pages" };
    }
    const res = await ingest(ctx.website, raw, { blobs: ctx.blobs, runId });
    await finishRun(runId, "succeeded", { [res.status]: 1 });
    return res;
  } catch (err) {
    await finishRun(runId, "failed", {}, String(err));
    throw err;
  }
}
