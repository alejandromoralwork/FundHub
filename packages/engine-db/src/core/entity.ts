/**
 * FILE: packages/engine-db/src/core/entity.ts
 * PART: shared package (packages/engine-db) — engine core, used by the engine workers and the admin console
 * WHAT IT DOES: Everything that works on a golden ENTITY as a whole:
 *   - mergeEntities(): fold a duplicate into the entity it duplicates (identifiers, names, records, history…);
 *   - recomputeEntity(): rebuild golden fields from current observations (core/golden.ts) and the
 *     classification from the rules (core/classify.ts), unless a person classified it;
 *   - linkRelations(): link clients to their own entity once it exists;
 *   - withActor(), applyManualEdit(), setManualRelation(), endRelation(): staff edits from the admin
 *     console. A staff edit is stored like any source ("manual"), so history, precedence and undo work the
 *     same way as for the registers — nothing is overwritten in place.
 * WHERE IT RUNS: on Node.js — engine workers (via services/engine/src/core/ingest.ts) and the admin console.
 * TYPESCRIPT YOU WILL SEE HERE: Drizzle query builder, `sql` templates, `Partial<T>`, `keyof`.
 */

import { and, eq, isNull, sql } from "drizzle-orm";
import { db, type EngineTx } from "../client";
import {
  activityCategories,
  changeEvents,
  classificationRules,
  cssfDetails,
  entities,
  entityIdentifiers,
  entityRelations,
  observations,
  sourceRecords,
  type Address,
  type ChangeKind,
  type ClassificationRule,
  type EngineSource,
  type EntityKind,
  type EntityStatus,
  type IdScheme,
  type RelationKind,
} from "../schema";
import { classify } from "./classify";
import { buildGolden } from "./golden";
import { normalizeCountries, normalizeName, sameValue } from "./normalize";

// ------------------------------------------------------------------ merging

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
  // Relations: as subject (its clients) skip duplicates of keep's own rows; as object (it is someone's client) just repoint.
  await tx.execute(sql`
    update entity_relations r set subject_entity_id = ${keep} where subject_entity_id = ${drop}
      and not exists (select 1 from entity_relations k where k.subject_entity_id = ${keep} and k.kind = r.kind and k.object_normalized_name = r.object_normalized_name and k.source = r.source)`);
  await tx.execute(sql`delete from entity_relations where subject_entity_id = ${drop}`);
  await tx.execute(sql`update entity_relations set object_entity_id = ${keep} where object_entity_id = ${drop}`);
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
    websiteVerifiedAt: g.websiteVerifiedAt ? new Date(g.websiteVerifiedAt) : entity.websiteVerifiedAt,
    operatingCountries: g.operatingCountries ?? entity.operatingCountries,
    logo: g.logo ?? entity.logo,
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

// ------------------------------------------------------------------ relations

/**
 * Kind: async function. Links relation objects (clients) that were written before their golden entity
 * existed: any unlinked relation whose name matches exactly one entity. Run after big loads (reclassify job).
 * @returns `Promise<number>` — how many relations were linked.
 */
export async function linkRelations(): Promise<number> {
  const res = await db.execute(sql`
    update entity_relations r set object_entity_id = u.id
    from (select min(id::text)::uuid as id, normalized_name from entities group by normalized_name having count(*) = 1) u
    where r.object_entity_id is null and r.object_normalized_name = u.normalized_name and u.id <> r.subject_entity_id`);
  return res.rowCount ?? 0;
}


// ------------------------------------------------------------------ staff edits ("manual" source)

/**
 * Kind: async function. Tags the current transaction with who is making changes. The row_history triggers
 * read it (`current_setting('app.actor')`), so every row change made in this transaction is attributed.
 * @param actor  e.g. "staff:jane@fundhub.lu" or "engine:cssf_fetch".
 */
export async function withActor(tx: EngineTx, actor: string) {
  await tx.execute(sql`select set_config('app.actor', ${actor}, true)`);
}

/** Kind: constant. Golden attributes staff may override. Identifiers (RCS number, LEI) are not editable here. */
export const MANUAL_ATTRIBUTES = ["name", "legalForm", "status", "address", "registrationDate", "website", "operatingCountries"] as const;
export type ManualAttribute = (typeof MANUAL_ATTRIBUTES)[number];

/** Kind: type alias. Values a staff member sets; `null` = remove the override (the registers take over again). */
export type ManualEdit = Partial<{
  name: string | null;
  legalForm: string | null;
  status: EntityStatus | null;
  address: Address | null;
  registrationDate: string | null;
  website: string | null;
  operatingCountries: string[] | null;
}>;

/** Kind: type alias. A manual classification, or "rules" to hand classification back to the rules. */
export type ManualClassification =
  | { isServiceProvider: boolean; entityKind: EntityKind; activityCategoryId: number | null; activitySubcategoryId: number | null; tier: number }
  | "rules";

const EVENT_KIND: Partial<Record<string, ChangeKind>> = { name: "name_change", status: "status_change", address: "address_change" };

/**
 * Kind: async function. The "manual" source record of an entity (one per entity), created on first use.
 * @returns `Promise<number>` — its id.
 */
async function manualRecord(tx: EngineTx, entityId: string): Promise<number> {
  const [r] = await tx
    .insert(sourceRecords)
    .values({ source: "manual", externalId: entityId, entityId, scope: "staff" })
    .onConflictDoUpdate({ target: [sourceRecords.source, sourceRecords.externalId], set: { lastSeenAt: new Date(), lastChangedAt: new Date() } })
    .returning({ id: sourceRecords.id });
  return r.id;
}

/**
 * Kind: async function. Applies a staff edit to an entity, inside the caller's transaction:
 * each changed attribute closes the previous manual observation and opens a new one (or only closes it when
 * the value is null = "remove override"), a change event records old → new golden value with the actor, the
 * classification is set (or handed back to the rules), and the golden record is recomputed.
 * @param tx              a transaction (call withActor(tx, actor) first so row_history knows who).
 * @param entityId        the entity.
 * @param edit            attributes to set or clear.
 * @param classification  optional manual classification, or "rules".
 * @param actor           who, for change_events.actor.
 * @returns `Promise<{ changed: string[] }>` — names of attributes / "classification" that changed.
 */
export async function applyManualEdit(
  tx: EngineTx,
  entityId: string,
  edit: ManualEdit,
  classification: ManualClassification | undefined,
  actor: string,
): Promise<{ changed: string[] }> {
  const [before] = await tx.select().from(entities).where(eq(entities.id, entityId));
  if (!before) throw new Error(`Entity ${entityId} not found`);
  const recordId = await manualRecord(tx, entityId);
  const open = await tx.select().from(observations).where(and(eq(observations.sourceRecordId, recordId), isNull(observations.validTo)));
  const now = new Date();
  const changed: string[] = [];
  const goldenKey: Record<ManualAttribute, keyof typeof before> = {
    name: "canonicalName",
    legalForm: "legalForm",
    status: "status",
    address: "registeredAddress",
    registrationDate: "registrationDate",
    website: "website",
    operatingCountries: "operatingCountries",
  };

  for (const attribute of MANUAL_ATTRIBUTES) {
    if (!(attribute in edit)) continue;
    let value: unknown = edit[attribute];
    if (attribute === "operatingCountries" && Array.isArray(value)) value = normalizeCountries(value as string[]);
    if (value === "" || value === undefined || (Array.isArray(value) && value.length === 0)) value = null;
    const current = open.find((o) => o.attribute === attribute);
    if (current && sameValue(current.value, value)) continue;
    if (!current && value === null) continue;
    if (current) await tx.update(observations).set({ validTo: now }).where(eq(observations.id, current.id));
    if (value !== null) await tx.insert(observations).values({ entityId, sourceRecordId: recordId, source: "manual", attribute, value, confidence: 1, validFrom: now });
    changed.push(attribute);
    await tx.insert(changeEvents).values({
      entityId,
      sourceRecordId: recordId,
      source: "manual",
      kind: EVENT_KIND[attribute] ?? "attribute_changed",
      attribute,
      oldValue: (before[goldenKey[attribute]] as unknown) ?? null,
      newValue: value === null ? { override: "removed" } : value,
      actor,
    });
  }

  if (classification) {
    const next =
      classification === "rules" ? { classificationSource: null, classifiedAt: now } : { ...classification, classificationSource: "manual" as const, classifiedAt: now };
    await tx.update(entities).set(next).where(eq(entities.id, entityId));
    changed.push("classification");
    await tx.insert(changeEvents).values({
      entityId,
      sourceRecordId: recordId,
      source: "manual",
      kind: "attribute_changed",
      attribute: "classification",
      oldValue: {
        isServiceProvider: before.isServiceProvider,
        entityKind: before.entityKind,
        activityCategoryId: before.activityCategoryId,
        activitySubcategoryId: before.activitySubcategoryId,
        tier: before.tier,
        source: before.classificationSource,
      },
      newValue: classification,
      actor,
    });
  }

  if (changed.length) await recomputeEntity(tx, entityId);
  return { changed };
}

/**
 * Kind: async function. Adds (or reopens / updates) a relation stated by staff, e.g. a client.
 * @returns `Promise<number>` — the relation id.
 */
export async function setManualRelation(
  tx: EngineTx,
  subjectEntityId: string,
  r: { kind: RelationKind; objectName: string; objectEntityId?: string | null; evidenceUrl?: string | null },
  actor: string,
): Promise<number> {
  const objectNormalizedName = normalizeName(r.objectName);
  if (!objectNormalizedName) throw new Error("Client name is empty");
  const recordId = await manualRecord(tx, subjectEntityId);
  const now = new Date();
  const [row] = await tx
    .insert(entityRelations)
    .values({
      subjectEntityId,
      kind: r.kind,
      objectName: r.objectName.trim(),
      objectNormalizedName,
      objectEntityId: r.objectEntityId ?? null,
      source: "manual",
      sourceRecordId: recordId,
      evidenceUrl: r.evidenceUrl ?? null,
      confidence: 1,
      validFrom: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [entityRelations.subjectEntityId, entityRelations.kind, entityRelations.objectNormalizedName, entityRelations.source],
      set: { objectName: r.objectName.trim(), objectEntityId: r.objectEntityId ?? null, evidenceUrl: r.evidenceUrl ?? null, validTo: null, lastSeenAt: now },
    })
    .returning({ id: entityRelations.id });
  await tx.insert(changeEvents).values({ entityId: subjectEntityId, sourceRecordId: recordId, source: "manual", kind: "relation_added", attribute: r.kind, newValue: r, actor });
  return row.id;
}

/** Kind: async function. Ends a relation (keeps it as history: valid_to = now). @returns false if already ended. */
export async function endRelation(tx: EngineTx, relationId: number, actor: string): Promise<boolean> {
  const [rel] = await tx
    .update(entityRelations)
    .set({ validTo: new Date() })
    .where(and(eq(entityRelations.id, relationId), isNull(entityRelations.validTo)))
    .returning();
  if (!rel) return false;
  await tx.insert(changeEvents).values({
    entityId: rel.subjectEntityId,
    source: "manual",
    kind: "relation_ended",
    attribute: rel.kind,
    oldValue: { objectName: rel.objectName, source: rel.source },
    actor,
  });
  return true;
}
