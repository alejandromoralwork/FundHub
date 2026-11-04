/**
 * FILE: services/engine/src/core/ingest.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: The one pipeline every source goes through, for one raw capture:
 *   parse → compare the content hash with last time → (if changed) store the raw bytes in object storage,
 *   record the capture, list the changes (core/diff.ts), update attribute history (`observations`),
 *   resolve the golden entity (core/resolve.ts — creating or merging), save register details (CSSF
 *   statuses, RCS filings), write change events, and recompute the golden record + classification.
 *   Unchanged content only bumps `last_seen_at`. A "not found" for a known id marks it "gone".
 *   Everything for one record happens in ONE transaction, with advisory locks on the record and on its
 *   identifiers, so parallel workers never create two entities for the same RCS number / LEI.
 * WHERE IT RUNS: engine workers and the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: Drizzle query builder (`tx.select().from().where()`), `sql` templates,
 *   `onConflictDoUpdate`, classes implementing an interface, `Map`.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, type EngineTx } from "@fundhub/engine-db/client";
import {
  activityCategories,
  captures,
  changeEvents,
  classificationRules,
  cssfDetails,
  entities,
  entityIdentifiers,
  entityNames,
  matchCandidates,
  observations,
  rcsFilings,
  sourceRecords,
  type ClassificationRule,
  type EngineSource,
  type IdScheme,
  type MatchMethod,
} from "@fundhub/engine-db/schema";
import { blobKey, sha256, type BlobStore } from "../storage";
import { classify } from "./classify";
import { diffRecords, type Change } from "./diff";
import { buildGolden } from "./golden";
import { contentHash, normalizeName, sameValue } from "./normalize";
import { resolveRecord, STRONG_SCHEMES, type ResolverStore } from "./resolve";
import type { ParsedRecord, RawCapture, SourceAdapter } from "./types";

/** Kind: type alias. What happened to one capture. */
export type IngestStatus = "new" | "changed" | "unchanged" | "not_found" | "gone";
export type IngestResult = { status: IngestStatus; entityId: string | null; sourceRecordId: number; changes: number };

/** Kind: type alias. Shared context of an ingest call. */
export type IngestContext = { blobs: BlobStore; runId?: number | null };

// ------------------------------------------------------------------ refresh policy

/**
 * Kind: function. Days until a record should be fetched again, by source and entity tier.
 * GLEIF is refreshed by its daily delta, so it returns null (no per-record schedule).
 */
export function refreshDays(source: EngineSource, tier: number): number | null {
  if (source === "cssf") return 7;
  if (source === "rcs") return tier >= 2 ? 7 : tier === 1 ? 30 : 365;
  if (source === "web") return tier >= 2 ? 30 : 90;
  return null;
}
const daysFromNow = (d: number | null) => (d === null ? null : new Date(Date.now() + d * 86_400_000));

// ------------------------------------------------------------------ resolver store (database side)

/** Kind: class. ResolverStore backed by the engine database, inside the current transaction. */
export class DbResolverStore implements ResolverStore {
  constructor(
    private tx: EngineTx,
    private sourceRecordId: number,
    private source: EngineSource,
  ) {}

  async findByIdentifier(scheme: IdScheme, value: string) {
    const [r] = await this.tx.select({ id: entityIdentifiers.entityId }).from(entityIdentifiers).where(and(eq(entityIdentifiers.scheme, scheme), eq(entityIdentifiers.value, value)));
    return r?.id ?? null;
  }

  async findByName(normalizedName: string) {
    const rows = await this.tx
      .select({ entityId: entities.id, postcode: sql<string | null>`${entities.registeredAddress}->>'postcode'` })
      .from(entities)
      .where(eq(entities.normalizedName, normalizedName))
      .limit(10);
    return rows;
  }

  async createEntity(seed: { canonicalName: string; normalizedName: string }) {
    const [r] = await this.tx.insert(entities).values(seed).returning({ id: entities.id });
    return r.id;
  }

  async addIdentifiers(entityId: string, ids: { scheme: IdScheme; value: string }[], source: EngineSource) {
    if (!ids.length) return;
    await this.tx
      .insert(entityIdentifiers)
      .values(ids.map((i) => ({ entityId, scheme: i.scheme, value: i.value, source })))
      .onConflictDoNothing();
  }

  async merge(keep: string, drop: string) {
    await mergeEntities(this.tx, keep, drop, this.source);
  }

  async addCandidate(entityId: string, method: MatchMethod, score: number, decision: "auto" | "pending") {
    await this.tx.insert(matchCandidates).values({ sourceRecordId: this.sourceRecordId, entityId, method, score, decision }).onConflictDoNothing();
  }
}

/**
 * Kind: async function. Merges entity `drop` into `keep`: moves identifiers, names, source records,
 * observations, events and candidates, keeps a manual classification, then deletes `drop`.
 */
export async function mergeEntities(tx: EngineTx, keep: string, drop: string, source: EngineSource) {
  if (keep === drop) return;
  await tx.execute(sql`update entity_identifiers set entity_id = ${keep} where entity_id = ${drop}`);
  await tx.execute(sql`
    update entity_names n set entity_id = ${keep} where entity_id = ${drop}
      and not exists (select 1 from entity_names k where k.entity_id = ${keep} and k.source = n.source and k.name = n.name)`);
  await tx.execute(sql`delete from entity_names where entity_id = ${drop}`);
  await tx.execute(sql`update source_records set entity_id = ${keep} where entity_id = ${drop}`);
  await tx.execute(sql`update observations set entity_id = ${keep} where entity_id = ${drop}`);
  await tx.execute(sql`update change_events set entity_id = ${keep} where entity_id = ${drop}`);
  await tx.execute(sql`
    update match_candidates m set entity_id = ${keep} where entity_id = ${drop}
      and not exists (select 1 from match_candidates k where k.entity_id = ${keep} and k.source_record_id = m.source_record_id)`);
  // A person's classification or website link on the dropped entity must survive the merge.
  await tx.execute(sql`
    update entities k set
      first_seen_at = least(k.first_seen_at, d.first_seen_at),
      website_provider_id = coalesce(k.website_provider_id, d.website_provider_id),
      is_service_provider = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.is_service_provider else k.is_service_provider end,
      entity_kind = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.entity_kind else k.entity_kind end,
      activity_category_id = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.activity_category_id else k.activity_category_id end,
      activity_subcategory_id = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.activity_subcategory_id else k.activity_subcategory_id end,
      classification_source = case when d.classification_source = 'manual' then 'manual' else k.classification_source end
    from entities d where k.id = ${keep} and d.id = ${drop}`);
  await tx.delete(entities).where(eq(entities.id, drop));
  await tx.insert(changeEvents).values({ entityId: keep, source, kind: "entities_merged", oldValue: { merged: drop } });
}

// ------------------------------------------------------------------ rules cache

let rulesCache: { at: number; rules: ClassificationRule[]; corporateId: number | null } | null = null;

/** Kind: async function. Classification rules + the "corporate" category id, cached for 5 minutes. */
async function loadRules(tx: EngineTx) {
  if (rulesCache && Date.now() - rulesCache.at < 300_000) return rulesCache;
  const rules = await tx.select().from(classificationRules);
  const [corp] = await tx.select({ id: activityCategories.id }).from(activityCategories).where(eq(activityCategories.slug, "corporate--other"));
  rulesCache = { at: Date.now(), rules, corporateId: corp?.id ?? null };
  return rulesCache;
}
/** Kind: function. Forget cached rules (after editing them). */
export const clearRulesCache = () => (rulesCache = null);

// ------------------------------------------------------------------ golden record

/**
 * Kind: async function. Rebuilds an entity's golden fields from the open observations of all its source
 * records, and its classification from the rules (unless a person classified it: "manual").
 * @returns `Promise<boolean>` — true when any golden field changed.
 */
export async function recomputeEntity(tx: EngineTx, entityId: string): Promise<boolean> {
  const [entity] = await tx.select().from(entities).where(eq(entities.id, entityId));
  if (!entity) return false;
  const claims = await tx
    .select({ source: observations.source, attribute: observations.attribute, value: observations.value })
    .from(observations)
    .where(and(eq(observations.entityId, entityId), isNull(observations.validTo)));
  const g = buildGolden(claims);

  // Only claim an RCS number / LEI on the golden record if the identifier really belongs to this entity.
  const ids = await tx.select().from(entityIdentifiers).where(eq(entityIdentifiers.entityId, entityId));
  const owns = (scheme: IdScheme, v: string | null | undefined) => !!v && ids.some((i) => i.scheme === scheme && i.value === v);
  const rcsNumber = owns("rcs", g.rcsNumber) ? g.rcsNumber! : (ids.find((i) => i.scheme === "rcs")?.value ?? null);
  const lei = owns("lei", g.lei) ? g.lei! : (ids.find((i) => i.scheme === "lei")?.value ?? null);

  const next = {
    canonicalName: g.canonicalName ?? entity.canonicalName,
    normalizedName: normalizeName(g.canonicalName ?? entity.canonicalName),
    legalForm: g.legalForm ?? entity.legalForm,
    status: g.status ?? entity.status,
    rcsNumber,
    lei,
    registeredAddress: g.registeredAddress ?? entity.registeredAddress,
    registrationDate: g.registrationDate ?? entity.registrationDate,
    website: g.website ?? entity.website,
  };

  let classification = {};
  if (entity.classificationSource !== "manual") {
    const types = await tx
      .selectDistinct({ scope: sourceRecords.scope })
      .from(sourceRecords)
      .where(and(eq(sourceRecords.entityId, entityId), eq(sourceRecords.source, "cssf"), eq(sourceRecords.state, "found")));
    const codes = await tx
      .selectDistinct({ code: cssfDetails.code })
      .from(cssfDetails)
      .innerJoin(sourceRecords, eq(sourceRecords.id, cssfDetails.sourceRecordId))
      .where(and(eq(sourceRecords.entityId, entityId), eq(cssfDetails.detailType, "ACTIVITY_CODE"), isNull(cssfDetails.endDate)));
    const { rules, corporateId } = await loadRules(tx);
    const c = classify(
      { cssfTypes: types.map((t) => t.scope!).filter(Boolean), cssfCodes: codes.map((c) => c.code), legalForm: next.legalForm, hasRcs: !!rcsNumber },
      rules,
      { corporateCategoryId: corporateId },
    );
    classification = {
      isServiceProvider: c.isServiceProvider,
      entityKind: c.entityKind,
      activityCategoryId: c.activityCategoryId,
      activitySubcategoryId: c.activitySubcategoryId,
      tier: Math.max(c.tier, entity.classificationSource === "ai" ? entity.tier : 0),
      classificationSource: "rule" as const,
      classifiedAt: new Date(),
    };
  }

  const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => !sameValue(next[k], entity[k]));
  await tx
    .update(entities)
    .set({ ...next, ...classification, lastSeenAt: new Date(), ...(changed ? { lastChangedAt: new Date() } : {}) })
    .where(eq(entities.id, entityId));
  return changed;
}

// ------------------------------------------------------------------ observations & details

/** Kind: async function. SCD2 update of one record's facts: close changed rows, open new ones. */
async function writeObservations(tx: EngineTx, rec: ParsedRecord, sourceRecordId: number, entityId: string, captureId: number) {
  const open = await tx.select().from(observations).where(and(eq(observations.sourceRecordId, sourceRecordId), isNull(observations.validTo)));
  const byAttr = new Map(open.map((o) => [o.attribute, o]));
  const now = new Date();
  for (const [attribute, value] of Object.entries(rec.facts)) {
    if (value === undefined) continue;
    const o = byAttr.get(attribute);
    byAttr.delete(attribute);
    if (o && sameValue(o.value, value)) continue;
    if (o) await tx.update(observations).set({ validTo: now }).where(eq(observations.id, o.id));
    await tx.insert(observations).values({ entityId, sourceRecordId, source: rec.source, attribute, value, captureId, validFrom: now });
  }
  // Attributes the source no longer states are closed.
  const gone = [...byAttr.values()].map((o) => o.id);
  if (gone.length) await tx.update(observations).set({ validTo: now }).where(inArray(observations.id, gone));
  // Keep every row of this record pointing at the (possibly new) entity.
  await tx.update(observations).set({ entityId }).where(eq(observations.sourceRecordId, sourceRecordId));
}

/** Kind: async function. Saves names, CSSF details and RCS filings of a record. */
async function writeDetails(tx: EngineTx, rec: ParsedRecord, sourceRecordId: number, entityId: string) {
  for (const n of rec.names) {
    await tx
      .insert(entityNames)
      .values({ entityId, name: n.name, kind: n.kind, source: rec.source, validFrom: n.validFrom })
      .onConflictDoUpdate({ target: [entityNames.entityId, entityNames.source, entityNames.name], set: { kind: n.kind, validFrom: n.validFrom } });
  }
  if (rec.cssfDetails) {
    const now = new Date();
    for (const d of rec.cssfDetails) {
      await tx
        .insert(cssfDetails)
        .values({ sourceRecordId, ...d })
        .onConflictDoUpdate({
          target: [cssfDetails.sourceRecordId, cssfDetails.detailType, cssfDetails.code],
          set: { kind: d.kind, label: d.label, lei: d.lei, startDate: d.startDate, endDate: d.endDate, lastSeenAt: now },
        });
    }
    // Lines that vanished from the register: close them (end date = today) instead of deleting history.
    const keep = rec.cssfDetails.map((d) => `${d.detailType}:${d.code}`);
    await tx.execute(sql`
      update cssf_details set end_date = coalesce(end_date, current_date)
      where source_record_id = ${sourceRecordId}
        and (detail_type || ':' || code) not in (select jsonb_array_elements_text(${JSON.stringify(keep)}::jsonb))`);
  }
  for (const f of rec.rcsFilings ?? []) {
    await tx
      .insert(rcsFilings)
      .values({ sourceRecordId, ...f })
      .onConflictDoUpdate({ target: rcsFilings.filingNumber, set: { correctedBy: f.correctedBy, corrects: f.corrects, details: f.details, hasDocuments: f.hasDocuments } });
  }
}

// ------------------------------------------------------------------ the pipeline

/**
 * Kind: async function. Ingests one raw capture end to end.
 * @param adapter  type `SourceAdapter` — provides `parse` and `parserVersion`.
 * @param raw      type `RawCapture`.
 * @param ctx      type `IngestContext` — blob store and current run id.
 * @returns `Promise<IngestResult>`.
 */
export async function ingest(adapter: SourceAdapter, raw: RawCapture, ctx: IngestContext): Promise<IngestResult> {
  const rec = adapter.parse(raw);
  const hash = rec.state === "found" ? contentHash(rec) : null;

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`rec:${rec.source}:${raw.externalId}`}))`);
    const [existing] = await tx.select().from(sourceRecords).where(and(eq(sourceRecords.source, rec.source), eq(sourceRecords.externalId, rec.externalId)));
    const now = new Date();

    // ---- the source says this id does not exist
    if (rec.state === "not_found") {
      if (!existing) {
        const [r] = await tx.insert(sourceRecords).values({ source: rec.source, externalId: rec.externalId, scope: rec.scope ?? null, state: "not_found" }).returning({ id: sourceRecords.id });
        return { status: "not_found" as const, entityId: null, sourceRecordId: r.id, changes: 0 };
      }
      if (existing.state === "found") {
        await tx.update(sourceRecords).set({ state: "gone", lastSeenAt: now, lastChangedAt: now }).where(eq(sourceRecords.id, existing.id));
        await tx.insert(changeEvents).values({ entityId: existing.entityId, sourceRecordId: existing.id, source: rec.source, kind: "record_gone" });
        return { status: "gone" as const, entityId: existing.entityId, sourceRecordId: existing.id, changes: 1 };
      }
      await tx.update(sourceRecords).set({ lastSeenAt: now }).where(eq(sourceRecords.id, existing.id));
      return { status: "not_found" as const, entityId: existing.entityId, sourceRecordId: existing.id, changes: 0 };
    }

    // ---- unchanged content: just note that we saw it
    const [ent] = existing?.entityId ? await tx.select({ tier: entities.tier }).from(entities).where(eq(entities.id, existing.entityId)) : [];
    if (existing && existing.state === "found" && existing.contentHash === hash) {
      await tx.update(sourceRecords).set({ lastSeenAt: now, attempts: 0, lastError: null, nextFetchAt: daysFromNow(refreshDays(rec.source, ent?.tier ?? 0)) }).where(eq(sourceRecords.id, existing.id));
      if (existing.entityId) await tx.update(entities).set({ lastSeenAt: now }).where(eq(entities.id, existing.entityId));
      return { status: "unchanged" as const, entityId: existing.entityId, sourceRecordId: existing.id, changes: 0 };
    }

    // ---- new or changed: keep the raw bytes, then everything else
    const rawHash = sha256(raw.body);
    const key = blobKey(`raw/${raw.source}`, rawHash, raw.ext);
    await ctx.blobs.put(key, raw.body, raw.contentType);

    const recordValues = { scope: rec.scope ?? null, state: "found" as const, contentHash: hash, parsed: rec as unknown as Record<string, unknown>, parserVersion: adapter.parserVersion, lastSeenAt: now, lastChangedAt: now, attempts: 0, lastError: null };
    const [sr] = existing
      ? await tx.update(sourceRecords).set(recordValues).where(eq(sourceRecords.id, existing.id)).returning()
      : await tx.insert(sourceRecords).values({ source: rec.source, externalId: rec.externalId, ...recordValues }).returning();

    const [cap] = await tx
      .insert(captures)
      .values({ sourceRecordId: sr.id, runId: ctx.runId ?? null, url: raw.url, httpStatus: raw.httpStatus, contentType: raw.contentType, bytes: raw.body.length, rawHash, blobKey: key, contentHash: hash, parsed: sr.parsed, parserVersion: adapter.parserVersion })
      .returning({ id: captures.id });

    const prev = existing?.state === "found" ? (existing.parsed as unknown as ParsedRecord) : null;
    const changes: Change[] = diffRecords(prev, rec);

    // Lock every strong identifier (sorted, to avoid deadlocks) before resolving.
    const idKeys = rec.identifiers.filter((i) => STRONG_SCHEMES.includes(i.scheme)).map((i) => `id:${i.scheme}:${i.value}`).sort();
    for (const k of idKeys) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${k}))`);
    const res = await resolveRecord(rec, new DbResolverStore(tx, sr.id, rec.source), existing?.entityId ?? null);

    await tx.update(sourceRecords).set({ entityId: res.entityId, latestCaptureId: cap.id }).where(eq(sourceRecords.id, sr.id));
    await writeObservations(tx, rec, sr.id, res.entityId, cap.id);
    await writeDetails(tx, rec, sr.id, res.entityId);

    const events = [...changes];
    if (res.created) events.unshift({ kind: "new_entity", newValue: { name: rec.facts.name ?? null, via: rec.source } });
    if (events.length) {
      await tx.insert(changeEvents).values(
        events.map((c) => ({ entityId: res.entityId, sourceRecordId: sr.id, source: rec.source, kind: c.kind, attribute: c.attribute ?? null, oldValue: c.oldValue ?? null, newValue: c.newValue ?? null })),
      );
    }

    await recomputeEntity(tx, res.entityId);
    const [after] = await tx.select({ tier: entities.tier }).from(entities).where(eq(entities.id, res.entityId));
    await tx.update(sourceRecords).set({ nextFetchAt: daysFromNow(refreshDays(rec.source, after?.tier ?? 0)) }).where(eq(sourceRecords.id, sr.id));

    return { status: existing ? ("changed" as const) : ("new" as const), entityId: res.entityId, sourceRecordId: sr.id, changes: events.length };
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
 * @returns `Promise<number>` — how many were marked gone.
 */
export async function markMissing(source: EngineSource, scope: string, seenIds: string[]): Promise<number> {
  return db.transaction(async (tx) => {
    const gone = await tx
      .update(sourceRecords)
      .set({ state: "gone", lastChangedAt: new Date() })
      .where(and(eq(sourceRecords.source, source), eq(sourceRecords.scope, scope), eq(sourceRecords.state, "found"), sql`${sourceRecords.externalId} not in (select jsonb_array_elements_text(${JSON.stringify(seenIds)}::jsonb))`))
      .returning({ id: sourceRecords.id, entityId: sourceRecords.entityId });
    if (gone.length) await tx.insert(changeEvents).values(gone.map((g) => ({ entityId: g.entityId, sourceRecordId: g.id, source, kind: "record_gone" as const })));
    return gone.length;
  });
}
