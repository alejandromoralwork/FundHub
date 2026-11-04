/**
 * FILE: services/engine/src/jobs/maintenance.ts
 * PART: scraping engine (services/engine) — jobs that are not tied to one source
 *   reclassify {}       — re-applies classification rules to every entity (after editing rules).
 *   census_snapshot {}  — writes today's registry-wide census (totals by kind, service providers, coverage).
 *   cssf_refresh {}     — queues `cssf_fetch` for CSSF records whose refresh date has passed.
 * WHERE IT RUNS: queue "maintenance" workers, or inline from the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: keyset pagination (`where id > last order by id limit n`).
 */

import { and, asc, eq, gt, lte } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { entities, sourceRecords } from "@fundhub/engine-db/schema";
import { clearRulesCache, recomputeEntity } from "../core/ingest";
import { snapshotRegistry } from "../core/ops";
import { log } from "../log";
import type { JobContext } from "./context";

/** Kind: async function. Job "reclassify". */
export async function reclassify() {
  clearRulesCache();
  let last = "00000000-0000-0000-0000-000000000000";
  let done = 0;
  for (;;) {
    const page = await db.select({ id: entities.id }).from(entities).where(gt(entities.id, last)).orderBy(asc(entities.id)).limit(500);
    if (!page.length) break;
    for (const e of page) await db.transaction((tx) => recomputeEntity(tx, e.id));
    done += page.length;
    last = page[page.length - 1].id;
    log.info("reclassify", { done });
  }
  return { entities: done };
}

/** Kind: async function. Job "census_snapshot". */
export async function censusSnapshot() {
  const rows = await snapshotRegistry();
  return Object.fromEntries(rows.map((r) => [r.scope, r.seen]));
}

/** Kind: async function. Job "cssf_refresh". */
export async function cssfRefresh(data: { limit?: number }, ctx: JobContext) {
  const due = await db
    .select({ id: sourceRecords.externalId })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.source, "cssf"), eq(sourceRecords.state, "found"), lte(sourceRecords.nextFetchAt, new Date())))
    .limit(data.limit ?? 1000);
  for (const d of due) await ctx.enqueue("cssf_fetch", { id: d.id }, { singletonKey: `cssf:${d.id}` });
  return { queued: due.length };
}
