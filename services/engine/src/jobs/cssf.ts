/**
 * FILE: services/engine/src/jobs/cssf.ts
 * PART: scraping engine (services/engine) — jobs for source "cssf"
 * WHAT IT DOES:
 *   cssf_census {types?, all?, limit?}  — walks the CSSF listing type by type; the API reports
 *       `totalElements`, so each type's census is exact. New ids, ids due for refresh (or every id with
 *       all=true) get a `cssf_fetch` job. A complete listing also marks ids no longer listed as "gone"
 *       (withdrawn) and writes the census row.
 *   cssf_fetch {id} — fetches one entity's details and ingests it.
 * WHERE IT RUNS: queue "cssf" workers, or inline from the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: `for await` over async generators, `Set`, `Map`.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { sourceRecords } from "@fundhub/engine-db/schema";
import { ingest, markMissing, recordFailure } from "../core/ingest";
import { finishRun, snapshotScope, startRun } from "../core/ops";
import { log } from "../log";
import { CENSUS_TYPES } from "../sources/cssf/adapter";
import type { JobContext } from "./context";

/** Kind: async function. Job "cssf_census". */
export async function cssfCensus(data: { types?: string[]; all?: boolean; limit?: number }, ctx: JobContext) {
  const types = data.types?.length ? data.types : CENSUS_TYPES;
  const runId = await startRun("cssf", "cssf_census", ctx.trigger, data);
  const stats = { types: 0, listed: 0, queued: 0, gone: 0 };
  try {
    for (const type of types) {
      const ids: string[] = [];
      let total = 0;
      for await (const page of ctx.cssf.listType(type)) {
        total = page.total;
        ids.push(...page.items.map((i) => String(i.entiteId)));
        if (data.limit && ids.length >= data.limit) break;
      }
      const picked = data.limit ? ids.slice(0, data.limit) : ids;
      stats.types++;
      stats.listed += picked.length;

      // Which ids need their details fetched: new, due, or everything when all=true.
      const known = picked.length
        ? await db
            .select({ id: sourceRecords.externalId, due: sourceRecords.nextFetchAt, state: sourceRecords.state })
            .from(sourceRecords)
            .where(and(eq(sourceRecords.source, "cssf"), inArray(sourceRecords.externalId, picked)))
        : [];
      const byId = new Map(known.map((k) => [k.id, k]));
      const now = Date.now();
      for (const id of picked) {
        const k = byId.get(id);
        if (data.all || !k || k.state !== "found" || !k.due || k.due.getTime() <= now) {
          await ctx.enqueue("cssf_fetch", { id }, { singletonKey: `cssf:${id}` });
          stats.queued++;
        }
      }

      // Only a COMPLETE listing may declare missing ids gone.
      if (!data.limit && ids.length === total) {
        stats.gone += await markMissing("cssf", type, ids);
        await snapshotScope("cssf", type, total);
      }
      log.info("cssf type listed", { type, total, listed: picked.length });
    }
    await finishRun(runId, "succeeded", stats);
  } catch (err) {
    await finishRun(runId, "failed", stats, String(err));
    throw err;
  }
  return stats;
}

/** Kind: async function. Job "cssf_fetch". */
export async function cssfFetch(data: { id: string | number }, ctx: JobContext) {
  const id = String(data.id);
  try {
    const raw = await ctx.cssf.fetch(id);
    if (!raw) return { status: "not_found" };
    const res = await ingest(ctx.cssf, raw, { blobs: ctx.blobs });
    log.info("cssf ingested", { id, status: res.status, changes: res.changes });
    return res;
  } catch (err) {
    await recordFailure("cssf", id, String(err));
    throw err;
  }
}
