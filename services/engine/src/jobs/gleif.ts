/**
 * FILE: services/engine/src/jobs/gleif.ts
 * PART: scraping engine (services/engine) — jobs for source "gleif"
 * WHAT IT DOES:
 *   gleif_sync {full?, since?, limit?} — ingests Luxembourg LEI records. Without `full`, it continues from
 *       the last successful sync (cursor "lastSync"), asking GLEIF only for records updated since then; the
 *       first run (no cursor) is a full load (~73k records, ~370 pages). Records are complete in the
 *       listing, so they are ingested directly — no per-record request.
 *   gleif_fetch {lei} — one record.
 * WHERE IT RUNS: queue "gleif" workers, or inline from the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: `for await`, ISO dates.
 */

import { ingest } from "../core/ingest";
import { finishRun, getCursor, setCursor, snapshotScope, startRun } from "../core/ops";
import { log } from "../log";
import type { JobContext } from "./context";

/** Kind: async function. Job "gleif_sync". */
export async function gleifSync(data: { full?: boolean; since?: string; limit?: number }, ctx: JobContext) {
  const startedAt = new Date().toISOString();
  const last = await getCursor<string>("gleif", "lastSync");
  const since = data.full ? undefined : (data.since ?? last);
  const runId = await startRun("gleif", "gleif_sync", ctx.trigger, { ...data, since: since ?? null });
  const stats: Record<string, number> = { seen: 0, new: 0, changed: 0, unchanged: 0, failed: 0 };
  let total: number | null = null;
  try {
    outer: for await (const page of ctx.gleif.list(since)) {
      total = page.total;
      for (const raw of page.items) {
        try {
          const res = await ingest(ctx.gleif, raw, { blobs: ctx.blobs, runId });
          stats[res.status] = (stats[res.status] ?? 0) + 1;
        } catch (err) {
          stats.failed++;
          log.warn("gleif record failed", { lei: raw.externalId, error: String(err) });
        }
        stats.seen++;
        if (data.limit && stats.seen >= data.limit) break outer;
      }
      log.info("gleif page", { seen: stats.seen, total });
    }
    // Only a finished, unlimited run moves the cursor forward.
    if (!data.limit) {
      await setCursor("gleif", "lastSync", startedAt);
      if (!since) await snapshotScope("gleif", "LU", total);
    }
    await finishRun(runId, "succeeded", stats);
  } catch (err) {
    await finishRun(runId, "failed", stats, String(err));
    throw err;
  }
  return stats;
}

/** Kind: async function. Job "gleif_fetch". */
export async function gleifFetch(data: { lei: string }, ctx: JobContext) {
  const raw = await ctx.gleif.fetch(data.lei);
  if (!raw) return { status: "not_found" };
  return ingest(ctx.gleif, raw, { blobs: ctx.blobs });
}
