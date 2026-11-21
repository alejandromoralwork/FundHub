/**
 * FILE: services/engine/src/pipeline/ingest.ts
 * PART: scraping engine (services/engine) — the pipeline entry point every source uses
 * WHAT IT DOES: Stage A for one acquired content version, then (if allowed) stage B:
 *
 *   ACQUIRE  raw bytes → object storage + raw.fetches            (only when the parsed content changed)
 *   PARSE    adapter.parse() → staging.parsed_records             (pure parser, per-source vocabulary)
 *   GATE     ops.review_policies → flow on, or hold as "pending"  (pipeline/gate.ts)
 *   RELEASE  clean → match → core                                 (pipeline/release.ts)
 *
 *   Unchanged content only bumps `last_seen_at`. A "not found" for a known id marks it "gone". A held version
 *   waits until a person approves / edits / rejects it in the console (Review → Staging approval), which
 *   queues the `staging_release` job → releaseApproved() below. A newer version arriving while one is pending
 *   supersedes it (the newest is what gets reviewed).
 *   Everything for one record happens in ONE transaction, under an advisory lock on the record.
 * WHERE IT RUNS: engine workers and the CLI.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { withActor } from "@fundhub/engine-db/core/entity";
import { changes, companies, fetches, parsedRecords, sourceRecords, sources, type EngineSource } from "@fundhub/engine-db/schema";
import { diffRecords } from "../core/diff";
import { contentHash } from "../core/normalize";
import type { ParsedRecord, RawCapture, SourceAdapter } from "../core/types";
import { blobKey, sha256, type BlobStore } from "../storage";
import { evaluate, loadPolicies, pickPolicy } from "./gate";
import { daysFromNow, refreshDays, releaseParsed, splitEdit, wouldCreateCompany } from "./release";

/** Kind: type alias. What happened to one acquired version. "held" = waiting at the approval gate. */
export type IngestStatus = "new" | "changed" | "unchanged" | "not_found" | "gone" | "held" | "skipped";
export type IngestResult = { status: IngestStatus; companyId: string | null; sourceRecordId: number; changes: number; reasons?: string[] };

/** Kind: type alias. Shared context of an ingest call. */
export type IngestContext = { blobs: BlobStore; runId?: number | null };

/**
 * Kind: async function. Ingests one raw capture end to end (or up to the gate).
 * @param adapter  provides `parse` and `parserVersion`.
 */
export async function ingest(adapter: SourceAdapter, raw: RawCapture, ctx: IngestContext): Promise<IngestResult> {
  const rec = adapter.parse(raw);
  return ingestParsed(rec, raw, adapter.parserVersion, ctx);
}

let enabledCache: { at: number; on: Map<string, boolean> } | null = null;
/** Kind: async function. Is the source enabled (ops.sources.enabled)? Cached for one minute; unknown = enabled. */
export async function sourceEnabled(source: EngineSource): Promise<boolean> {
  if (!enabledCache || Date.now() - enabledCache.at > 60_000) {
    const rows = await db.select({ code: sources.code, enabled: sources.enabled }).from(sources);
    enabledCache = { at: Date.now(), on: new Map(rows.map((r) => [r.code, r.enabled])) };
  }
  return enabledCache.on.get(source) ?? true;
}

/** Kind: async function. Same as ingest() for a record parsed by the caller (multi-record files, FundHub sync…). */
export async function ingestParsed(rec: ParsedRecord, raw: RawCapture, parserVersion: number, ctx: IngestContext): Promise<IngestResult> {
  // A source switched off in the console (Sources page) stores nothing new.
  if (!(await sourceEnabled(rec.source))) return { status: "skipped", companyId: null, sourceRecordId: 0, changes: 0 };
  const hash = rec.state === "found" ? contentHash(rec) : null;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rec:${rec.source}:${rec.externalId}`}))`);
    await withActor(tx, `engine:${rec.source}`);
    const [existing] = await tx.select().from(sourceRecords).where(and(eq(sourceRecords.source, rec.source), eq(sourceRecords.externalId, rec.externalId)));
    const now = new Date();

    // ---- the source says this id does not exist
    if (rec.state === "not_found") {
      if (!existing) {
        const [r] = await tx.insert(sourceRecords).values({ source: rec.source, externalId: rec.externalId, scope: rec.scope ?? null, state: "not_found" }).returning({ id: sourceRecords.id });
        return { status: "not_found" as const, companyId: null, sourceRecordId: r.id, changes: 0 };
      }
      if (existing.state === "found") {
        await tx.update(sourceRecords).set({ state: "gone", lastSeenAt: now, lastChangedAt: now }).where(eq(sourceRecords.id, existing.id));
        await tx.insert(changes).values({ companyId: existing.companyId, sourceRecordId: existing.id, source: rec.source, kind: "record_gone" });
        return { status: "gone" as const, companyId: existing.companyId, sourceRecordId: existing.id, changes: 1 };
      }
      await tx.update(sourceRecords).set({ lastSeenAt: now }).where(eq(sourceRecords.id, existing.id));
      return { status: "not_found" as const, companyId: existing.companyId, sourceRecordId: existing.id, changes: 0 };
    }

    // ---- unchanged vs what was released (or vs the version already waiting): just note that we saw it
    const [pending] = existing
      ? await tx.select({ id: parsedRecords.id, contentHash: parsedRecords.contentHash }).from(parsedRecords).where(and(eq(parsedRecords.sourceRecordId, existing.id), eq(parsedRecords.reviewStatus, "pending")))
      : [];
    if (existing && existing.state === "found" && (existing.contentHash === hash || pending?.contentHash === hash)) {
      const [c] = existing.companyId ? await tx.select({ tier: companies.tier }).from(companies).where(eq(companies.id, existing.companyId)) : [];
      await tx.update(sourceRecords).set({ lastSeenAt: now, attempts: 0, lastError: null, nextFetchAt: daysFromNow(await refreshDays(tx, rec.source, c?.tier ?? 0)) }).where(eq(sourceRecords.id, existing.id));
      if (existing.companyId) await tx.update(companies).set({ lastSeenAt: now }).where(eq(companies.id, existing.companyId));
      return { status: pending ? ("held" as const) : ("unchanged" as const), companyId: existing.companyId, sourceRecordId: existing.id, changes: 0 };
    }

    // ---- ACQUIRE: keep the raw bytes
    const rawHash = sha256(raw.body);
    const key = blobKey(`raw/${raw.source}`, rawHash, raw.ext);
    await ctx.blobs.put(key, raw.body, raw.contentType);
    const [sr] = existing
      ? await tx.update(sourceRecords).set({ scope: rec.scope ?? null, state: "found", lastSeenAt: now, attempts: 0, lastError: null }).where(eq(sourceRecords.id, existing.id)).returning()
      : await tx.insert(sourceRecords).values({ source: rec.source, externalId: rec.externalId, scope: rec.scope ?? null, state: "found" }).returning();
    const [fetch] = await tx
      .insert(fetches)
      .values({ source: rec.source, sourceRecordId: sr.id, runId: ctx.runId ?? null, url: raw.url, httpStatus: raw.httpStatus, contentType: raw.contentType, bytes: raw.body.length, rawHash, blobKey: key })
      .returning({ id: fetches.id });
    await tx.update(sourceRecords).set({ latestFetchId: fetch.id }).where(eq(sourceRecords.id, sr.id));

    // ---- PARSE → staging
    const [parsed] = await tx
      .insert(parsedRecords)
      .values({ sourceRecordId: sr.id, fetchId: fetch.id, parserVersion, contentHash: hash!, payload: rec as unknown as Record<string, unknown> })
      .returning({ id: parsedRecords.id });
    if (pending) await tx.update(parsedRecords).set({ reviewStatus: "superseded" }).where(eq(parsedRecords.id, pending.id));

    // ---- GATE
    const prev = existing?.released ? (existing.released as unknown as ParsedRecord) : null;
    const [prevParsed] = existing?.releasedParsedId ? await tx.select({ v: parsedRecords.parserVersion }).from(parsedRecords).where(eq(parsedRecords.id, existing.releasedParsedId)) : [];
    const decision = evaluate(pickPolicy(await loadPolicies(), rec.source, rec.scope ?? null), {
      source: rec.source,
      scope: rec.scope ?? null,
      newRecord: !prev,
      newCompany: await wouldCreateCompany(tx, rec, sr.companyId),
      parserChanged: !!prevParsed && prevParsed.v !== parserVersion,
      changes: diffRecords(prev, rec),
      confidence: rec.confidence ?? null,
    });
    if (decision.hold) {
      await tx.update(parsedRecords).set({ reviewStatus: "pending", reviewReasons: decision.reasons, reviewPolicyId: decision.policyId }).where(eq(parsedRecords.id, parsed.id));
      await tx.update(sourceRecords).set({ lastChangedAt: now }).where(eq(sourceRecords.id, sr.id));
      return { status: "held" as const, companyId: sr.companyId, sourceRecordId: sr.id, changes: 0, reasons: decision.reasons };
    }

    // ---- RELEASE (stage B)
    const res = await releaseParsed(tx, { parsedId: parsed.id, sourceRecordId: sr.id, rec, prev, linkedCompanyId: sr.companyId, contentHash: hash!, actor: `engine:${rec.source}` });
    return { status: existing?.released ? ("changed" as const) : ("new" as const), companyId: res.companyId, sourceRecordId: sr.id, changes: res.changes };
  });
}

/**
 * Kind: async function. Releases a version a person approved ("approved") or corrected ("edited") at the gate.
 * Called by the `staging_release` job the console queues. Rejected / superseded / already-released versions
 * are ignored, so the job is safe to repeat.
 * @returns what happened, or null when there was nothing to release.
 */
export async function releaseApproved(parsedId: number) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(parsedRecords).where(eq(parsedRecords.id, parsedId));
    if (!p || p.releasedAt || (p.reviewStatus !== "approved" && p.reviewStatus !== "edited")) return null;
    const [sr] = await tx.select().from(sourceRecords).where(eq(sourceRecords.id, p.sourceRecordId));
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rec:${sr.source}:${sr.externalId}`}))`);
    const actor = p.reviewedBy ? `staff:${p.reviewedBy}` : "staff:unknown";
    await withActor(tx, actor);
    const original = p.payload as unknown as ParsedRecord;
    const { rec, manual } = p.reviewStatus === "edited" && p.editedPayload ? splitEdit(original, p.editedPayload as unknown as ParsedRecord) : { rec: original, manual: {} };
    const prev = sr.released ? (sr.released as unknown as ParsedRecord) : null;
    return releaseParsed(tx, { parsedId: p.id, sourceRecordId: sr.id, rec, prev, linkedCompanyId: sr.companyId, contentHash: p.contentHash, actor, manual });
  });
}

/**
 * Kind: async function. Records a fetch error on a KNOWN source record, pushing its next refresh back
 * (1 day per failed attempt, at most 7). Unknown ids are not inserted: the queue's own retries cover them.
 */
export async function recordFailure(source: EngineSource, externalId: string, error: string) {
  await db
    .update(sourceRecords)
    .set({ attempts: sql`${sourceRecords.attempts} + 1`, lastError: error.slice(0, 500), nextFetchAt: sql`now() + (least(${sourceRecords.attempts} + 1, 7) || ' days')::interval` })
    .where(and(eq(sourceRecords.source, source), eq(sourceRecords.externalId, externalId)));
}

/**
 * Kind: async function. After a COMPLETE listing of a scope (e.g. all CSSF "SPP"), marks records of that
 * scope that were not in the listing as "gone" (withdrawn from the register) and logs events.
 * @returns how many were marked gone.
 */
export async function markMissing(source: EngineSource, scope: string, seenIds: string[]): Promise<number> {
  return db.transaction(async (tx) => {
    const gone = await tx
      .update(sourceRecords)
      .set({ state: "gone", lastChangedAt: new Date() })
      .where(and(eq(sourceRecords.source, source), eq(sourceRecords.scope, scope), eq(sourceRecords.state, "found"), sql`${sourceRecords.externalId} not in (select jsonb_array_elements_text(${JSON.stringify(seenIds)}::jsonb))`))
      .returning({ id: sourceRecords.id, companyId: sourceRecords.companyId });
    if (gone.length) await tx.insert(changes).values(gone.map((g) => ({ companyId: g.companyId, sourceRecordId: g.id, source, kind: "record_gone" as const })));
    return gone.length;
  });
}

// Company-level operations (merge, consolidate, rules, relation linking) live in
// packages/engine-db/src/core/entity.ts, shared with the admin console.
export { clearRulesCache, linkRelations, recomputeCompany } from "@fundhub/engine-db/core/entity";
