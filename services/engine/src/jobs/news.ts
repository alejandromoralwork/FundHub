/**
 * FILE: services/engine/src/jobs/news.ts
 * PART: scraping engine (services/engine) — jobs of the "news" group
 * WHAT IT DOES:
 *   - news_poll: reads every enabled feed in ops.news_feeds (or one, `feedId`); each new article goes
 *     through the pipeline (source "news"), where the companies it mentions are detected.
 *   - news_search: with `companyId`, searches the news for that company (its article mentions get a
 *     confidence bonus); without, queues the followed companies (tier 2, FundHub listings) whose last search
 *     is the oldest.
 * WHERE IT RUNS: engine workers (group "news").
 */

import { eq, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { newsFeeds } from "@fundhub/engine-db/schema";
import { finishRun, getCursor, setCursor, startRun } from "../core/ops";
import { log } from "../log";
import { ingest } from "../pipeline/ingest";
import { pressName } from "../pipeline/mentions";
import type { FeedItem } from "../sources/news/parse";
import type { JobContext } from "./context";

/** Kind: async function. Ingests feed items; returns counters. */
async function ingestItems(items: FeedItem[], feed: { id: number | null; name: string; language: string | null }, targetCompanyId: string | null, ctx: JobContext, runId: number) {
  const stats: Record<string, number> = { items: 0, new: 0, unchanged: 0, held: 0, failed: 0 };
  for (const item of items) {
    stats.items++;
    try {
      const res = await ingest(ctx.news, ctx.news.toRaw(item, feed, targetCompanyId), { blobs: ctx.blobs, runId });
      stats[res.status] = (stats[res.status] ?? 0) + 1;
    } catch (err) {
      stats.failed++;
      log.warn("news item failed", { url: item.link, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return stats;
}

/** Kind: async function. Job "news_poll". */
export async function newsPoll(data: { feedId?: number }, ctx: JobContext) {
  const feeds = (await db.select().from(newsFeeds)).filter((f) => f.enabled && (!data.feedId || f.id === data.feedId));
  const runId = await startRun("news", "news_poll", ctx.trigger, data);
  const total: Record<string, number> = { feeds: 0, items: 0, new: 0, failed: 0 };
  for (const f of feeds) {
    total.feeds++;
    try {
      const { items, etag, lastModified } = await ctx.news.fetchFeed(f);
      const s = items ? await ingestItems(items, { id: f.id, name: f.name, language: f.language }, null, ctx, runId) : { items: 0, new: 0 };
      for (const [k, v] of Object.entries(s)) total[k] = (total[k] ?? 0) + v;
      await db.update(newsFeeds).set({ etag, lastModified, lastPolledAt: new Date(), lastError: null, articles: sql`${newsFeeds.articles} + ${s.new ?? 0}` }).where(eq(newsFeeds.id, f.id));
    } catch (err) {
      total.failed++;
      await db.update(newsFeeds).set({ lastPolledAt: new Date(), lastError: String(err).slice(0, 300) }).where(eq(newsFeeds.id, f.id));
    }
  }
  await finishRun(runId, "succeeded", total);
  return total;
}

/** Kind: async function. Job "news_search". */
export async function newsSearch(data: { companyId?: string; limit?: number }, ctx: JobContext) {
  if (!data.companyId) {
    const followed = (
      await db.execute<{ id: string }>(sql`
        select id from core.companies
        where status = 'active' and (tier >= 2 or website_provider_id is not null)
        order by id limit 5000`)
    ).rows.map((r) => r.id);
    // Rotate through the followed companies: a cursor remembers where the last batch stopped.
    const offset = (await getCursor<number>("news", "searchOffset")) ?? 0;
    const n = Math.min(data.limit ?? ctx.cfg.news.searchBatch, followed.length);
    const batch = Array.from({ length: n }, (_, i) => followed[(offset + i) % Math.max(followed.length, 1)]);
    for (const id of batch) await ctx.enqueue("news_search", { companyId: id }, { singletonKey: `news:${id}` });
    await setCursor("news", "searchOffset", followed.length ? (offset + n) % followed.length : 0);
    return { queued: batch.length };
  }
  const [c] = (await db.execute<{ id: string; canonical_name: string }>(sql`select id, canonical_name from core.companies where id = ${data.companyId}`)).rows;
  if (!c) return { status: "unknown_company" };
  const runId = await startRun("news", "news_search", ctx.trigger, data);
  try {
    const items = await ctx.news.searchCompany(pressName(c.canonical_name), ctx.cfg.news.searchLanguage);
    const stats = await ingestItems(items.slice(0, 30), { id: null, name: "news search", language: ctx.cfg.news.searchLanguage }, c.id, ctx, runId);
    await finishRun(runId, "succeeded", stats);
    return stats;
  } catch (err) {
    await finishRun(runId, "failed", {}, String(err));
    throw err;
  }
}
