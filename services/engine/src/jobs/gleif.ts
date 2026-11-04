/**
 * FILE: services/engine/src/jobs/gleif.ts
 * PART: scraping engine (services/engine) — jobs for source "gleif"
 * WHAT IT DOES:
 *   gleif_sync {full?, since?, limit?} — ingests Luxembourg LEI records. Without `full`, it continues from
 *       the last successful sync (cursor "lastSync"), asking GLEIF only for records updated since then; the
 *       first run (no cursor) is a full load (~73k records, ~370 pages). Records are complete in the
 *       listing, so they are ingested directly — no per-record request — 4 at a time (advisory locks in
 *       ingest() keep parallel writes safe).
 *       A long load survives interruptions: after every page the next-page link is saved (cursor
 *       "resumeUrl"), and the next run of the same kind continues from there instead of starting over.
 *   gleif_fetch {lei} — one record.
 * WHERE IT RUNS: queue "gleif" workers, or inline from the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: `for await`, a tiny concurrency pool with `Promise.all`.
 */

import { ingest } from "../core/ingest";
import { finishRun, getCursor, setCursor, snapshotScope, startRun } from "../core/ops";
import type { RawCapture } from "../core/types";
import { log } from "../log";
import type { JobContext } from "./context";

/** Kind: constant. Records ingested in parallel per page. */
const CONCURRENCY = 4;

/** Kind: type alias. Where an interrupted sync stopped. */
type Resume = { url: string; since: string | null; startedAt: string };

/** Kind: async function. Job "gleif_sync". */
export async function gleifSync(data: { full?: boolean; since?: string; limit?: number }, ctx: JobContext) {
  const last = await getCursor<string>("gleif", "lastSync");
  const since = data.full ? undefined : (data.since ?? last);
  // Resume an interrupted run of the same kind (same `since`), unless this is a limited test run.
  const resume = data.limit ? undefined : await getCursor<Resume | null>("gleif", "resume");
  const resuming = resume && resume.since === (since ?? null) ? resume : undefined;
  const startedAt = resuming?.startedAt ?? new Date().toISOString();
  const runId = await startRun("gleif", "gleif_sync", ctx.trigger, { ...data, since: since ?? null, resumed: !!resuming });
  const stats: Record<string, number> = { seen: 0, new: 0, changed: 0, unchanged: 0, failed: 0 };
  let total: number | null = null;

  const one = async (raw: RawCapture) => {
    try {
      const res = await ingest(ctx.gleif, raw, { blobs: ctx.blobs, runId });
      stats[res.status] = (stats[res.status] ?? 0) + 1;
    } catch (err) {
      stats.failed++;
      const e = err as Error & { cause?: { message?: string } };
      log.warn("gleif record failed", { lei: raw.externalId, error: e.cause?.message ?? e.message });
    }
  };

  try {
    if (resuming) log.info("gleif resuming", { from: resuming.url });
    outer: for await (const page of ctx.gleif.list(since, resuming?.url)) {
      total = page.total;
      let items = page.items;
      if (data.limit) items = items.slice(0, Math.max(0, data.limit - stats.seen));
      for (let i = 0; i < items.length; i += CONCURRENCY) await Promise.all(items.slice(i, i + CONCURRENCY).map(one));
      stats.seen += items.length;
      if (!data.limit) await setCursor("gleif", "resume", page.next ? ({ url: page.next, since: since ?? null, startedAt } satisfies Resume) : null);
      log.info("gleif page", { seen: stats.seen, total });
      if (data.limit && stats.seen >= data.limit) break outer;
    }
    // Only a finished, unlimited run moves the cursor forward.
    if (!data.limit) {
      await setCursor("gleif", "lastSync", startedAt);
      await setCursor("gleif", "resume", null);
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
