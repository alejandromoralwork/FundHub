/**
 * FILE: services/engine/src/jobs/rcs.ts
 * PART: scraping engine (services/engine) — jobs for source "rcs"
 * WHAT IT DOES: The RCS census and refresh, paced like a person and only while the LuxTrust session is OK.
 *   rcs_fetch {rcs}          — one company page (e.g. "B145917").
 *   rcs_frontier {prefix, from?} — finds NEW registrations: probes numbers above the highest known one until
 *                                `RCS_FRONTIER_MISSES` consecutive numbers do not exist. Daily.
 *   rcs_sweep {prefix, batch?}  — backfill: walks 1…max_known in batches, skipping numbers already known,
 *                                then queues the next batch (self-chaining) until the whole range is done.
 *   rcs_refresh {limit?}     — queues `rcs_fetch` for records whose refresh date has passed (tier decides
 *                                how often: weekly / monthly / yearly, see core/ingest.ts refreshDays()).
 *   Every RCS request passes `gate()`: session healthy, inside active hours, under the daily cap. When the
 *   gate is closed, work is re-queued for later instead of failing. Bot checks / logouts mark the session
 *   unhealthy and stop RCS work until `engine rcs:login` is done again.
 * WHERE IT RUNS: the single RCS worker (queue "rcs"), or inline from the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: discriminated unions (`{ ok: true } | { ok: false; … }`), `instanceof`.
 */

import { and, asc, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { entities, rcsNumberSpace, sourceRecords } from "@fundhub/engine-db/schema";
import { ingest, recordFailure, type IngestResult } from "../core/ingest";
import { normalizeRcs, splitRcs } from "../core/normalize";
import { bumpCounter, finishRun, getCursor, getSessionHealth, setSessionHealth, snapshotScope, startRun, today } from "../core/ops";
import { log } from "../log";
import { RcsSessionError } from "../sources/rcs/browser";
import type { JobContext } from "./context";

/** Kind: type alias. Whether RCS work may run now; if not, when to try again. */
type Gate = { ok: true } | { ok: false; reason: string; retryAt: Date };

/** Kind: function. Next moment the active-hours window opens (local time of the worker). */
function nextWindow(startHour: number): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  if (d.getHours() >= startHour) d.setDate(d.getDate() + 1);
  d.setHours(startHour);
  return d;
}

/**
 * Kind: async function. Checks the session, the active hours and the daily cap.
 * @returns `Promise<Gate>`.
 */
export async function gate(ctx: JobContext): Promise<Gate> {
  const health = await getSessionHealth("rcs");
  // Only a session a person confirmed with `engine rcs:login` may be used ("unknown" counts as not ready).
  if (health !== "ok") return { ok: false, reason: `session ${health} — run \`engine rcs:login\``, retryAt: new Date(Date.now() + 30 * 60_000) };
  const [from, to] = ctx.cfg.rcs.activeHours;
  const h = new Date().getHours();
  if (h < from || h >= to) return { ok: false, reason: "outside active hours", retryAt: nextWindow(from) };
  const used = (await getCursor<number>("rcs", `daily:${today()}`)) ?? 0;
  if (used >= ctx.cfg.rcs.dailyCap) return { ok: false, reason: "daily cap reached", retryAt: nextWindow(from) };
  return { ok: true };
}

/**
 * Kind: async function. Fetches and ingests one RCS number (gate already passed).
 * Updates the daily counter and the prefix frontier. Session problems are recorded and re-thrown.
 */
async function fetchOne(rcs: string, ctx: JobContext): Promise<IngestResult> {
  const { adapter } = ctx.rcs();
  try {
    const raw = await adapter.fetch(rcs);
    await bumpCounter("rcs", `daily:${today()}`);
    const res = await ingest(adapter, raw, { blobs: ctx.blobs });
    if (res.status !== "not_found") {
      const [prefix, n] = splitRcs(rcs);
      await db.update(rcsNumberSpace).set({ maxKnown: sql`greatest(${rcsNumberSpace.maxKnown}, ${n})`, updatedAt: new Date() }).where(eq(rcsNumberSpace.prefix, prefix));
    }
    log.info("rcs ingested", { rcs, status: res.status, changes: res.changes });
    return res;
  } catch (err) {
    if (err instanceof RcsSessionError) {
      await setSessionHealth("rcs", err.state, err.message);
      log.error("RCS session needs attention — RCS work paused", { state: err.state, message: err.message });
    } else {
      await recordFailure("rcs", rcs, String(err));
    }
    throw err;
  }
}

/** Kind: async function. Job "rcs_fetch". */
export async function rcsFetch(data: { rcs: string }, ctx: JobContext) {
  const rcs = normalizeRcs(data.rcs);
  if (!rcs) throw new Error(`Not an RCS number: ${data.rcs}`);
  const g = await gate(ctx);
  if (!g.ok) {
    await ctx.enqueue("rcs_fetch", { rcs }, { singletonKey: `rcs:${rcs}`, startAfter: g.retryAt });
    return { deferred: g.reason };
  }
  return fetchOne(rcs, ctx);
}

/** Kind: async function. Job "rcs_frontier": probe above the highest known number. */
export async function rcsFrontier(data: { prefix?: string; from?: number }, ctx: JobContext) {
  const prefix = data.prefix ?? "B";
  const [space] = await db.select().from(rcsNumberSpace).where(eq(rcsNumberSpace.prefix, prefix));
  if (!space) throw new Error(`Unknown RCS prefix ${prefix} (run engine:db:seed)`);
  let n = data.from ?? space.maxKnown + 1;
  if (n <= 1) throw new Error(`No frontier yet for ${prefix}: run once with --from <a recent number>, e.g. --from 290000`);

  const runId = await startRun("rcs", "rcs_frontier", ctx.trigger, { prefix, from: n });
  const stats = { probed: 0, found: 0 };
  let misses = 0;
  try {
    while (misses < ctx.cfg.rcs.frontierMisses) {
      const g = await gate(ctx);
      if (!g.ok) {
        log.info("rcs frontier paused", { reason: g.reason });
        break;
      }
      const res = await fetchOne(`${prefix}${n}`, ctx);
      stats.probed++;
      if (res.status === "not_found") misses++;
      else {
        misses = 0;
        stats.found++;
      }
      n++;
    }
    await snapshotScope("rcs", prefix, null);
    await finishRun(runId, "succeeded", stats);
  } catch (err) {
    await finishRun(runId, err instanceof RcsSessionError ? "paused" : "failed", stats, String(err));
    throw err;
  }
  return stats;
}

/** Kind: async function. Job "rcs_sweep": backfill one batch of the number range, then chain the next. */
export async function rcsSweep(data: { prefix?: string; batch?: number }, ctx: JobContext) {
  const prefix = data.prefix ?? "B";
  const batch = data.batch ?? 200;
  const [space] = await db.select().from(rcsNumberSpace).where(eq(rcsNumberSpace.prefix, prefix));
  if (!space?.enabled) return { skipped: "prefix disabled" };
  if (space.sweptTo >= space.maxKnown) return { done: true };

  const runId = await startRun("rcs", "rcs_sweep", ctx.trigger, { prefix, from: space.sweptTo + 1 });
  const stats = { probed: 0, skipped: 0 };
  let n = space.sweptTo;
  try {
    const end = Math.min(space.sweptTo + batch, space.maxKnown);
    while (n < end) {
      const next = n + 1;
      const rcs = `${prefix}${next}`;
      const [known] = await db.select({ id: sourceRecords.id }).from(sourceRecords).where(and(eq(sourceRecords.source, "rcs"), eq(sourceRecords.externalId, rcs)));
      if (known) stats.skipped++;
      else {
        const g = await gate(ctx);
        if (!g.ok) {
          // Resume this sweep when the gate opens again.
          await ctx.enqueue("rcs_sweep", { prefix, batch }, { singletonKey: `rcs_sweep:${prefix}`, startAfter: g.retryAt });
          break;
        }
        await fetchOne(rcs, ctx);
        stats.probed++;
      }
      n = next;
      await db.update(rcsNumberSpace).set({ sweptTo: n, updatedAt: new Date() }).where(eq(rcsNumberSpace.prefix, prefix));
    }
    if (n === end && n < space.maxKnown) await ctx.enqueue("rcs_sweep", { prefix, batch }, { singletonKey: `rcs_sweep:${prefix}` });
    await finishRun(runId, "succeeded", stats);
  } catch (err) {
    await finishRun(runId, err instanceof RcsSessionError ? "paused" : "failed", stats, String(err));
    throw err;
  }
  return { ...stats, sweptTo: n };
}

/**
 * Kind: async function. Job "rcs_refresh". Queues, within the daily budget:
 *   1. entities we know an RCS number for (from GLEIF / CSSF) but never fetched from the RCS — highest tier
 *      first, so service providers and asset managers get their filings before the blind sweep reaches them;
 *   2. RCS records whose refresh date has passed, highest tier first.
 */
export async function rcsRefresh(data: { limit?: number }, ctx: JobContext) {
  const limit = data.limit ?? ctx.cfg.rcs.dailyCap;
  const missing = (
    await db.execute<{ rcs: string }>(sql`
      select i.value as rcs from entity_identifiers i
      join entities e on e.id = i.entity_id
      where i.scheme = 'rcs'
        and not exists (select 1 from source_records s where s.source = 'rcs' and s.external_id = i.value)
      order by e.tier desc, e.is_service_provider desc
      limit ${limit}`)
  ).rows;
  const due = await db
    .select({ rcs: sourceRecords.externalId })
    .from(sourceRecords)
    .leftJoin(entities, eq(entities.id, sourceRecords.entityId))
    .where(and(eq(sourceRecords.source, "rcs"), eq(sourceRecords.state, "found"), lte(sourceRecords.nextFetchAt, new Date())))
    .orderBy(desc(entities.tier), asc(sourceRecords.nextFetchAt))
    .limit(Math.max(0, limit - missing.length));
  for (const d of [...missing, ...due]) await ctx.enqueue("rcs_fetch", { rcs: d.rcs }, { singletonKey: `rcs:${d.rcs}` });
  return { queuedKnown: missing.length, queuedDue: due.length };
}
