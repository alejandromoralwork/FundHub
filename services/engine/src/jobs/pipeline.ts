/**
 * FILE: services/engine/src/jobs/pipeline.ts
 * PART: scraping engine (services/engine) — pipeline maintenance jobs ("maintenance" group)
 * WHAT IT DOES:
 *   - staging_release: releases a version a person approved / corrected at the gate (queued by the console).
 *   - quality_run: measures every data-quality check (pipeline/quality.ts).
 *   - publish_proposals: Intelligence DB → website proposals for staff review (pipeline/publish.ts).
 *   - reprocess: re-runs part of the pipeline for one source without re-fetching:
 *       from "parse"        latest raw fetch of each record → parser → gate → release (after a parser fix);
 *       from "consolidate"  recompute the golden record of every company the source feeds (after a
 *                           precedence or rules change).
 *   - retention_purge: deletes people / positions of sources with a retention limit (GDPR minimization)
 *     that were not seen within it, and people left with no position.
 * WHERE IT RUNS: engine workers.
 */

import { and, eq, isNotNull, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { clearPrecedenceCache, recomputeCompany } from "@fundhub/engine-db/core/entity";
import { fetches, sourceRecords, type EngineSource } from "@fundhub/engine-db/schema";
import type { RawCapture, SourceAdapter } from "../core/types";
import { log } from "../log";
import { ingestParsed, releaseApproved } from "../pipeline/ingest";
import { publishProposals } from "../pipeline/publish";
import { runQualityChecks } from "../pipeline/quality";
import type { JobContext } from "./context";

/** Kind: async function. Job "staging_release". */
export async function stagingRelease(data: { parsedId: number }) {
  const res = await releaseApproved(Number(data.parsedId));
  return res ?? { status: "nothing_to_release" };
}

/** Kind: async function. Job "quality_run". */
export const qualityRun = () => runQualityChecks();

/** Kind: async function. Job "publish_proposals". */
export const publishJob = (data: { limit?: number; dryRun?: boolean }, ctx: JobContext) => publishProposals({ publishUrl: ctx.cfg.websiteDb.publishUrl, ...data });

/** Kind: function. The adapter that can re-parse a source's raw content. */
function adapterFor(source: EngineSource, ctx: JobContext): SourceAdapter | null {
  if (source === "cssf") return ctx.cssf;
  if (source === "gleif") return ctx.gleif;
  if (source === "website") return ctx.website;
  if (source === "news") return ctx.news;
  if (source === "fundhub") return ctx.fundhub;
  if (source === "rcs") return ctx.rcs().adapter;
  return null;
}

/** Kind: async function. Job "reprocess". */
export async function reprocess(data: { source: EngineSource; from: "parse" | "consolidate"; limit?: number }, ctx: JobContext) {
  const stats: Record<string, number> = { records: 0, failed: 0 };
  if (data.from === "consolidate") {
    clearPrecedenceCache();
    const ids = (await db.selectDistinct({ id: sourceRecords.companyId }).from(sourceRecords).where(and(eq(sourceRecords.source, data.source), isNotNull(sourceRecords.companyId))).limit(data.limit ?? 1_000_000)).map((r) => r.id!);
    for (let i = 0; i < ids.length; i += 200) {
      await db.transaction(async (tx) => {
        for (const id of ids.slice(i, i + 200)) await recomputeCompany(tx, id);
      });
      stats.records += Math.min(200, ids.length - i);
    }
    return stats;
  }
  const adapter = adapterFor(data.source, ctx);
  if (!adapter) throw new Error(`Source ${data.source} cannot be re-parsed`);
  const rows = await db
    .select({ externalId: sourceRecords.externalId, url: fetches.url, blobKey: fetches.blobKey, contentType: fetches.contentType, httpStatus: fetches.httpStatus })
    .from(sourceRecords)
    .innerJoin(fetches, eq(fetches.id, sourceRecords.latestFetchId))
    .where(eq(sourceRecords.source, data.source))
    .limit(data.limit ?? 1_000_000);
  for (const r of rows) {
    const body = await ctx.blobs.get(r.blobKey);
    if (!body) {
      stats.failed++;
      continue;
    }
    const raw: RawCapture = { source: data.source, externalId: r.externalId, url: r.url, httpStatus: r.httpStatus, contentType: r.contentType ?? "application/octet-stream", body, ext: r.blobKey.split(".").pop() ?? "bin" };
    try {
      const res = await ingestParsed(adapter.parse(raw), raw, adapter.parserVersion, { blobs: ctx.blobs });
      stats[res.status] = (stats[res.status] ?? 0) + 1;
    } catch (err) {
      stats.failed++;
      log.warn("reprocess failed", { source: data.source, id: r.externalId, error: err instanceof Error ? err.message : String(err) });
    }
    stats.records++;
  }
  return stats;
}

/** Kind: async function. Job "retention_purge". */
export async function retentionPurge() {
  const res = await db.execute(sql`
    delete from core.positions p using ops.sources s
    where s.code = p.source and s.retention_days is not null and p.last_seen_at < now() - (s.retention_days || ' days')::interval`);
  const orphans = await db.execute(sql`delete from core.people x where not exists (select 1 from core.positions p where p.person_id = x.id)`);
  return { positions: res.rowCount ?? 0, people: orphans.rowCount ?? 0 };
}

/** Kind: async function. Deletes everything about one person (GDPR erasure), by profile URL or exact name. */
export async function erasePerson(by: { profileUrl?: string; fullName?: string }) {
  const where = by.profileUrl ? sql`profile_url = ${by.profileUrl}` : sql`lower(full_name) = lower(${by.fullName ?? ""})`;
  const ids = (await db.execute<{ id: string }>(sql`select id from core.people where ${where}`)).rows.map((r) => r.id);
  if (!ids.length) return 0;
  await db.execute(sql`delete from core.people where id in ${ids}`);
  return ids.length;
}

