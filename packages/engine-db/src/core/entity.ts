/**
 * FILE: packages/engine-db/src/core/entity.ts
 * PART: shared package (packages/engine-db) — engine core, used by the engine workers and the admin console
 * WHAT IT DOES: Everything that works on a golden COMPANY as a whole (core layer):
 *   - mergeCompanies(): fold a duplicate into the company it duplicates (identifiers, names, records, history…);
 *   - recomputeCompany(): rebuild golden fields from current claims (core/golden.ts) and the
 *     classification from the rules (core/classify.ts), unless a person classified it;
 *   - linkRelations(): link clients to their own entity once it exists;
 *   - withActor(), applyManualEdit(), setManualRelation(), endRelation(): staff edits from the admin
 *     console. A staff edit is stored like any source ("manual"), so history, precedence and undo work the
 *     same way as for the registers — nothing is overwritten in place.
 * WHERE IT RUNS: on Node.js — engine workers (via services/engine/src/core/ingest.ts) and the admin console.
 * TYPESCRIPT YOU WILL SEE HERE: Drizzle query builder, `sql` templates, `Partial<T>`, `keyof`.
 */

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, type EngineTx } from "../client";
import {
  activityCategories,
  attributePrecedence,
  changes,
  conflicts,
  fieldLineage,
  classificationRules,
  licences,
  companies,
  companyIdentifiers,
  companyRelations,
  claims,
  companyGroupMembers,
  companyGroups,
  sourceRecords,
  type Address,
  type GroupRole,
  type FundLaw,
  type FundRegime,
  type FundRole,
  type LegalVehicle,
  type ManagerType,
  type ChangeKind,
  type ClassificationRule,
  type EngineSource,
  type CompanyKind,
  type CompanyStatus,
  type IdScheme,
  type RelationKind,
} from "../schema";
import { classify } from "./classify";
import { fundProfile, mergeKind } from "./fund-profile";
import { loadCategories, serviceRowsFromIds, serviceRowsFromLabels, syncServices } from "./services";
import { consolidate, PRECEDENCE, type Precedence } from "./golden";
import { normalizeCountries, normalizeName, sameValue } from "./normalize";

// ------------------------------------------------------------------ merging

/**
 * Kind: async function. Merges entity `drop` into `keep`: moves identifiers, names, source records,
 * claims, events and candidates, keeps a manual classification, then deletes `drop`.
 */
export async function mergeCompanies(tx: EngineTx, keep: string, drop: string, source: EngineSource) {
  if (keep === drop) return;
  await tx.execute(sql`update core.company_identifiers set company_id = ${keep} where company_id = ${drop}`);
  await tx.execute(sql`
    update core.company_names n set company_id = ${keep} where company_id = ${drop}
      and not exists (select 1 from core.company_names k where k.company_id = ${keep} and k.source = n.source and k.name = n.name)`);
  await tx.execute(sql`delete from core.company_names where company_id = ${drop}`);
  await tx.execute(sql`update staging.source_records set company_id = ${keep} where company_id = ${drop}`);
  await tx.execute(sql`update clean.claims set company_id = ${keep} where company_id = ${drop}`);
  await tx.execute(sql`update core.changes set company_id = ${keep} where company_id = ${drop}`);
  // Relations: as subject (its clients) skip duplicates of keep's own rows; as object (it is someone's client) just repoint.
  await tx.execute(sql`
    update core.company_relations r set subject_company_id = ${keep} where subject_company_id = ${drop}
      and not exists (select 1 from core.company_relations k where k.subject_company_id = ${keep} and k.kind = r.kind and k.object_normalized_name = r.object_normalized_name and k.source = r.source)`);
  await tx.execute(sql`delete from core.company_relations where subject_company_id = ${drop}`);
  await tx.execute(sql`update core.company_relations set object_company_id = ${keep} where object_company_id = ${drop}`);
  await tx.execute(sql`
    update match.candidates m set company_id = ${keep} where company_id = ${drop}
      and not exists (select 1 from match.candidates k where k.company_id = ${keep} and k.source_record_id = m.source_record_id)`);
  await tx.execute(sql`
    update core.positions p set company_id = ${keep} where company_id = ${drop}
      and not exists (select 1 from core.positions k where k.company_id = ${keep} and k.person_id = p.person_id and k.title = p.title and k.source = p.source)`);
  await tx.execute(sql`
    update core.web_presence w set company_id = ${keep} where company_id = ${drop}
      and not exists (select 1 from core.web_presence k where k.company_id = ${keep} and k.platform = w.platform and k.url = w.url)`);
  // Group memberships follow the kept company (unless it is already in that group); groups headed by drop too.
  await tx.execute(sql`
    update core.company_group_members m set company_id = ${keep} where company_id = ${drop}
      and not exists (select 1 from core.company_group_members k where k.company_id = ${keep} and k.group_id = m.group_id)`);
  await tx.execute(sql`update core.company_groups set head_company_id = ${keep} where head_company_id = ${drop}`);
  await tx.execute(sql`
    update core.news_mentions m set company_id = ${keep} where company_id = ${drop}
      and not exists (select 1 from core.news_mentions k where k.company_id = ${keep} and k.article_id = m.article_id)`);
  // Lineage and conflicts of the dropped company are rebuilt on keep by the next recompute (they cascade away).
  // A person's classification or website link on the dropped company must survive the merge.
  await tx.execute(sql`
    update core.companies k set
      first_seen_at = least(k.first_seen_at, d.first_seen_at),
      website_provider_id = coalesce(k.website_provider_id, d.website_provider_id),
      is_service_provider = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.is_service_provider else k.is_service_provider end,
      company_kind = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.company_kind else k.company_kind end,
      activity_category_id = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.activity_category_id else k.activity_category_id end,
      activity_subcategory_id = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.activity_subcategory_id else k.activity_subcategory_id end,
      fund_regime = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.fund_regime else k.fund_regime end,
      fund_law = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.fund_law else k.fund_law end,
      legal_vehicle = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.legal_vehicle else k.legal_vehicle end,
      fund_role = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.fund_role else k.fund_role end,
      manager_type = case when d.classification_source = 'manual' and k.classification_source is distinct from 'manual' then d.manager_type else k.manager_type end,
      classification_source = case when d.classification_source = 'manual' then 'manual' else k.classification_source end
    from core.companies d where k.id = ${keep} and d.id = ${drop}`);
  await tx.delete(companies).where(eq(companies.id, drop));
  await tx.insert(changes).values({ companyId: keep, source, kind: "companies_merged", oldValue: { merged: drop } });
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

// ------------------------------------------------------------------ precedence cache

let precedenceCache: { at: number; value: Precedence } | null = null;

/** Kind: async function. ops.attribute_precedence as attribute → sources (rank order), cached for 5 minutes. */
export async function loadPrecedence(tx: EngineTx): Promise<Precedence> {
  if (precedenceCache && Date.now() - precedenceCache.at < 300_000) return precedenceCache.value;
  const rows = await tx.select().from(attributePrecedence).orderBy(asc(attributePrecedence.attribute), asc(attributePrecedence.rank));
  const value: Precedence = {};
  for (const r of rows) (value[r.attribute] ??= []).push(r.source);
  precedenceCache = { at: Date.now(), value: rows.length ? value : PRECEDENCE };
  return precedenceCache.value;
}
/** Kind: function. Forget cached precedence (after editing it in the console). */
export const clearPrecedenceCache = () => (precedenceCache = null);

// ------------------------------------------------------------------ golden record (consolidate stage)

/**
 * Kind: async function. The CONSOLIDATE stage for one company: rebuilds its golden fields from the open
 * claims of all its source records (core/golden.ts consolidate()), writes the lineage of each field, opens /
 * updates / closes cross-source conflicts, updates the source count, and recomputes the classification from
 * the rules (unless a person classified it: "manual").
 * @returns `Promise<boolean>` — true when any golden field changed.
 */
export async function recomputeCompany(tx: EngineTx, companyId: string): Promise<boolean> {
  const [company] = await tx.select().from(companies).where(eq(companies.id, companyId));
  if (!company) return false;
  const current = await tx
    .select({ id: claims.id, source: claims.source, attribute: claims.attribute, value: claims.value })
    .from(claims)
    .where(and(eq(claims.companyId, companyId), isNull(claims.validTo)));
  const result = consolidate(current, await loadPrecedence(tx));
  const g = result.golden;

  // Only put an RCS number / LEI on the golden record if the identifier really belongs to this company.
  const ids = await tx.select().from(companyIdentifiers).where(eq(companyIdentifiers.companyId, companyId));
  const owns = (scheme: IdScheme, v: string | null | undefined) => !!v && ids.some((i) => i.scheme === scheme && i.value === v);
  const rcsNumber = owns("rcs", g.rcsNumber) ? g.rcsNumber! : (ids.find((i) => i.scheme === "rcs")?.value ?? null);
  const lei = owns("lei", g.lei) ? g.lei! : (ids.find((i) => i.scheme === "lei")?.value ?? null);

  const next = {
    canonicalName: g.canonicalName ?? company.canonicalName,
    normalizedName: normalizeName(g.canonicalName ?? company.canonicalName),
    legalForm: g.legalForm ?? company.legalForm,
    status: g.status ?? company.status,
    rcsNumber,
    lei,
    registeredAddress: g.registeredAddress ?? company.registeredAddress,
    registrationDate: g.registrationDate ?? company.registrationDate,
    website: g.website ?? company.website,
    websiteVerifiedAt: g.websiteVerifiedAt ? new Date(g.websiteVerifiedAt) : company.websiteVerifiedAt,
    description: g.description ?? company.description,
    phone: g.phone ?? company.phone,
    email: g.email ?? company.email,
    headcount: g.headcount ?? company.headcount,
    foundedYear: g.foundedYear ?? company.foundedYear,
    operatingCountries: g.operatingCountries ?? company.operatingCountries,
    services: g.services ?? company.services,
    logo: g.logo ?? company.logo,
  };

  let classification = {};
  if (company.classificationSource !== "manual") {
    const types = await tx
      .selectDistinct({ scope: sourceRecords.scope })
      .from(sourceRecords)
      .where(and(eq(sourceRecords.companyId, companyId), eq(sourceRecords.source, "cssf"), eq(sourceRecords.state, "found")));
    const codes = await tx
      .selectDistinct({ code: licences.code })
      .from(licences)
      .innerJoin(sourceRecords, eq(sourceRecords.id, licences.sourceRecordId))
      .where(and(eq(sourceRecords.companyId, companyId), eq(licences.detailType, "ACTIVITY_CODE"), isNull(licences.endDate)));
    const { rules, corporateId } = await loadRules(tx);
    const cssfTypes = types.map((t) => t.scope!).filter(Boolean);
    // Fund profile first: name rules ("… Advisory", "… Services") never apply to funds, fund vehicles, managers.
    const fp = fundProfile(await fundProfileInput(tx, companyId, next.canonicalName, next.legalForm, cssfTypes, current));
    const c = classify(
      { cssfTypes, cssfCodes: codes.map((c) => c.code), legalForm: next.legalForm, hasRcs: !!rcsNumber, name: next.canonicalName, allowNameRules: !fp.kind },
      rules,
      { corporateCategoryId: corporateId },
    );
    classification = {
      isServiceProvider: c.isServiceProvider,
      companyKind: mergeKind(c.companyKind, fp),
      fundRegime: fp.fundRegime,
      fundLaw: fp.fundLaw,
      legalVehicle: fp.legalVehicle,
      fundRole: fp.fundRole,
      managerType: fp.managerType,
      activityCategoryId: c.activityCategoryId,
      activitySubcategoryId: c.activitySubcategoryId,
      tier: Math.max(c.tier, company.classificationSource === "ai" ? company.tier : 0),
      classificationSource: "rule" as const,
      classifiedAt: new Date(),
    };
  }

  // Services offered (several per company): from the rules (even when a person froze the classification, the
  // licences still say what the company offers) and from each source that states services in words.
  {
    const types = await tx.selectDistinct({ scope: sourceRecords.scope }).from(sourceRecords)
      .where(and(eq(sourceRecords.companyId, companyId), eq(sourceRecords.source, "cssf"), eq(sourceRecords.state, "found")));
    const codes = await tx.selectDistinct({ code: licences.code }).from(licences)
      .innerJoin(sourceRecords, eq(sourceRecords.id, licences.sourceRecordId))
      .where(and(eq(sourceRecords.companyId, companyId), eq(licences.detailType, "ACTIVITY_CODE"), isNull(licences.endDate)));
    const { rules } = await loadRules(tx);
    const isFundWorld = ["fund", "fund_vehicle"].includes(String(company.companyKind)) || !!company.fundRole;
    const c = classify({ cssfTypes: types.map((t) => t.scope!).filter(Boolean), cssfCodes: codes.map((x) => x.code), legalForm: next.legalForm, hasRcs: !!rcsNumber, name: next.canonicalName, allowNameRules: !isFundWorld }, rules);
    await syncServices(tx, companyId, "rule", serviceRowsFromIds(c.serviceIds));
    const cats = await loadCategories(tx);
    const stated = new Map<string, unknown>();
    for (const cl of current) if (cl.attribute === "services" && cl.source !== "manual") stated.set(cl.source, cl.value);
    for (const src of ["fundhub", "website"]) await syncServices(tx, companyId, src, serviceRowsFromLabels(stated.get(src), cats));
  }

  const changed = (Object.keys(next) as (keyof typeof next)[]).some((k) => !sameValue(next[k], company[k]));
  await tx
    .update(companies)
    .set({ ...next, ...classification, sourceCount: result.sourceCount, lastSeenAt: new Date(), ...(changed ? { lastChangedAt: new Date() } : {}) })
    .where(eq(companies.id, companyId));

  // Lineage: one row per golden field; fields no source states any more are removed.
  await tx.delete(fieldLineage).where(eq(fieldLineage.companyId, companyId));
  if (result.lineage.length) {
    await tx.insert(fieldLineage).values(result.lineage.map((l) => ({ companyId, attribute: l.attribute, claimId: l.claimId, source: l.source, value: l.value, sourcesAgreeing: l.sourcesAgreeing, sourcesTotal: l.sourcesTotal })));
  }

  // Conflicts: open / refresh the ones found; close (resolved) the ones that disappeared. Ignored ones stay ignored.
  const existing = await tx.select().from(conflicts).where(eq(conflicts.companyId, companyId));
  const now = new Date();
  for (const c of result.conflicts) {
    const before = existing.find((e) => e.attribute === c.attribute);
    if (!before) {
      await tx.insert(conflicts).values({ companyId, attribute: c.attribute, values: c.values, winner: c.winner });
      await tx.insert(changes).values({ companyId, source: c.winner, kind: "conflict_detected", attribute: c.attribute, newValue: c.values });
    } else if (!sameValue(before.values, c.values) || before.winner !== c.winner) {
      const reopen = before.status === "resolved" ? { status: "open" as const, resolvedBy: null, resolvedAt: null } : {};
      await tx.update(conflicts).set({ values: c.values, winner: c.winner, updatedAt: now, ...reopen }).where(eq(conflicts.id, before.id));
    }
  }
  const gone = existing.filter((e) => e.status === "open" && !result.conflicts.some((c) => c.attribute === e.attribute));
  for (const e of gone) await tx.update(conflicts).set({ status: "resolved", resolvedBy: "engine:sources-agree", resolvedAt: now, updatedAt: now }).where(eq(conflicts.id, e.id));

  return changed;
}

/**
 * Kind: async function. Gathers what fundProfile() needs for one company: CSSF groups and sub-groups and GLEIF
 * category / legal form (from its current claims), how many sub-funds the CSSF lists, and its role in a fund
 * structure group with the umbrella's regime and law (for inheritance).
 */
async function fundProfileInput(
  tx: EngineTx,
  companyId: string,
  name: string,
  legalForm: string | null,
  cssfTypes: string[],
  current: { source: string; attribute: string; value: unknown }[],
) {
  const values = (source: string, attribute: string) =>
    current.filter((c) => c.source === source && c.attribute === attribute && typeof c.value === "string").map((c) => c.value as string);
  const [comp] = (
    await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from clean.licences l join staging.source_records r on r.id = l.source_record_id
      where r.company_id = ${companyId} and l.kind = 'compartment' and l.end_date is null`)
  ).rows;
  const [member] = await tx
    .select({ role: companyGroupMembers.role, headId: companyGroups.headCompanyId })
    .from(companyGroupMembers)
    .innerJoin(companyGroups, eq(companyGroups.id, companyGroupMembers.groupId))
    .where(and(eq(companyGroupMembers.companyId, companyId), isNull(companyGroupMembers.validTo), eq(companyGroups.kind, "fund_structure")))
    // Staff memberships first; then a structure whose head has a regime of its own (a sub-fund listed both under the
    // CSSF umbrella and under a GLEIF copy of it inherits from the one that knows UCITS / AIF); then confidence.
    .orderBy(
      sql`case when ${companyGroupMembers.source} = 'manual' then 0 else 1 end`,
      sql`(select h.fund_regime from core.companies h where h.id = ${companyGroups.headCompanyId}) is null`,
      sql`${companyGroupMembers.confidence} desc`,
    )
    .limit(1);
  let parentFund = null;
  if (member?.headId && member.headId !== companyId) {
    const [h] = await tx.select({ fundRegime: companies.fundRegime, fundLaw: companies.fundLaw }).from(companies).where(eq(companies.id, member.headId));
    parentFund = h ?? null;
  }
  return {
    name,
    legalForm,
    cssfTypes,
    cssfGroups: values("cssf", "cssfGroup"),
    cssfSubGroups: values("cssf", "cssfSubGroup"),
    compartments: comp?.n ?? 0,
    gleifCategory: values("gleif", "gleifCategory")[0] ?? null,
    gleifLegalForm: values("gleif", "legalForm")[0] ?? null,
    structureRole: (member?.role as GroupRole | undefined) ?? null,
    parentFund,
  };
}

// ------------------------------------------------------------------ relations

/**
 * Kind: async function. Links relation objects (clients) that were written before their golden entity
 * existed: any unlinked relation whose name matches exactly one entity. Run after big loads (reclassify job).
 * @returns `Promise<number>` — how many relations were linked.
 */
export async function linkRelations(): Promise<number> {
  const res = await db.execute(sql`
    update core.company_relations r set object_company_id = u.id
    from (select min(id::text)::uuid as id, normalized_name from core.companies group by normalized_name having count(*) = 1) u
    where r.object_company_id is null and r.object_normalized_name = u.normalized_name and u.id <> r.subject_company_id`);
  return res.rowCount ?? 0;
}


// ------------------------------------------------------------------ staff edits ("manual" source)

/**
 * Kind: async function. Tags the current transaction with who is making changes. The core.row_history triggers
 * read it (`current_setting('app.actor')`), so every row change made in this transaction is attributed.
 * @param actor  e.g. "staff:jane@fundhub.lu" or "engine:cssf_fetch".
 */
export async function withActor(tx: EngineTx, actor: string) {
  await tx.execute(sql`select set_config('app.actor', ${actor}, true)`);
}

/** Kind: constant. Golden attributes staff may override. Identifiers (RCS number, LEI) are not editable here. */
export const MANUAL_ATTRIBUTES = ["name", "legalForm", "status", "address", "registrationDate", "website", "description", "phone", "email", "headcount", "foundedYear", "operatingCountries", "services"] as const;
export type ManualAttribute = (typeof MANUAL_ATTRIBUTES)[number];

/** Kind: type alias. Values a staff member sets; `null` = remove the override (the registers take over again). */
export type ManualEdit = Partial<{
  name: string | null;
  legalForm: string | null;
  status: CompanyStatus | null;
  address: Address | null;
  registrationDate: string | null;
  website: string | null;
  description: string | null;
  phone: string | null;
  email: string | null;
  headcount: number | null;
  foundedYear: number | null;
  operatingCountries: string[] | null;
  services: string[] | null;
}>;

/** Kind: type alias. A manual classification, or "rules" to hand classification back to the rules. */
export type ManualClassification =
  | {
      isServiceProvider: boolean;
      companyKind: CompanyKind;
      activityCategoryId: number | null;
      activitySubcategoryId: number | null;
      tier: number;
      // Fund profile (optional: fields not sent keep their current value).
      fundRegime?: FundRegime | null;
      fundLaw?: FundLaw | null;
      legalVehicle?: LegalVehicle | null;
      fundRole?: FundRole | null;
      managerType?: ManagerType | null;
    }
  | "rules";

const EVENT_KIND: Partial<Record<string, ChangeKind>> = { name: "name_change", status: "status_change", address: "address_change" };

/**
 * Kind: async function. The "manual" source record of an entity (one per entity), created on first use.
 * @returns `Promise<number>` — its id.
 */
async function manualRecord(tx: EngineTx, companyId: string): Promise<number> {
  const [r] = await tx
    .insert(sourceRecords)
    .values({ source: "manual", externalId: companyId, companyId, scope: "staff" })
    .onConflictDoUpdate({ target: [sourceRecords.source, sourceRecords.externalId], set: { lastSeenAt: new Date(), lastChangedAt: new Date() } })
    .returning({ id: sourceRecords.id });
  return r.id;
}

/**
 * Kind: async function. Applies a staff edit to an entity, inside the caller's transaction:
 * each changed attribute closes the previous manual observation and opens a new one (or only closes it when
 * the value is null = "remove override"), a change event records old → new golden value with the actor, the
 * classification is set (or handed back to the rules), and the golden record is recomputed.
 * @param tx              a transaction (call withActor(tx, actor) first so core.row_history knows who).
 * @param companyId        the entity.
 * @param edit            attributes to set or clear.
 * @param classification  optional manual classification, or "rules".
 * @param actor           who, for core.changes.actor.
 * @returns `Promise<{ changed: string[] }>` — names of attributes / "classification" that changed.
 */
export async function applyManualEdit(
  tx: EngineTx,
  companyId: string,
  edit: ManualEdit,
  classification: ManualClassification | undefined,
  actor: string,
): Promise<{ changed: string[] }> {
  const [before] = await tx.select().from(companies).where(eq(companies.id, companyId));
  if (!before) throw new Error(`Company ${companyId} not found`);
  const recordId = await manualRecord(tx, companyId);
  const open = await tx.select().from(claims).where(and(eq(claims.sourceRecordId, recordId), isNull(claims.validTo)));
  const now = new Date();
  const changed: string[] = [];
  const goldenKey: Record<ManualAttribute, keyof typeof before> = {
    name: "canonicalName",
    legalForm: "legalForm",
    status: "status",
    address: "registeredAddress",
    registrationDate: "registrationDate",
    website: "website",
    description: "description",
    phone: "phone",
    email: "email",
    headcount: "headcount",
    foundedYear: "foundedYear",
    operatingCountries: "operatingCountries",
    services: "services",
  };

  for (const attribute of MANUAL_ATTRIBUTES) {
    if (!(attribute in edit)) continue;
    let value: unknown = edit[attribute];
    if (attribute === "operatingCountries" && Array.isArray(value)) value = normalizeCountries(value as string[]);
    if (value === "" || value === undefined || (Array.isArray(value) && value.length === 0)) value = null;
    const current = open.find((o) => o.attribute === attribute);
    if (current && sameValue(current.value, value)) continue;
    if (!current && value === null) continue;
    if (current) await tx.update(claims).set({ validTo: now }).where(eq(claims.id, current.id));
    if (value !== null) await tx.insert(claims).values({ companyId, sourceRecordId: recordId, source: "manual", attribute, value, confidence: 1, validFrom: now });
    changed.push(attribute);
    await tx.insert(changes).values({
      companyId,
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
    await tx.update(companies).set(next).where(eq(companies.id, companyId));
    changed.push("classification");
    await tx.insert(changes).values({
      companyId,
      sourceRecordId: recordId,
      source: "manual",
      kind: "attribute_changed",
      attribute: "classification",
      oldValue: {
        isServiceProvider: before.isServiceProvider,
        companyKind: before.companyKind,
        activityCategoryId: before.activityCategoryId,
        activitySubcategoryId: before.activitySubcategoryId,
        tier: before.tier,
        source: before.classificationSource,
      },
      newValue: classification,
      actor,
    });
  }

  if (changed.length) await recomputeCompany(tx, companyId);
  return { changed };
}

/**
 * Kind: async function. Adds (or reopens / updates) a relation stated by staff, e.g. a client.
 * @returns `Promise<number>` — the relation id.
 */
export async function setManualRelation(
  tx: EngineTx,
  subjectCompanyId: string,
  r: { kind: RelationKind; objectName: string; objectCompanyId?: string | null; evidenceUrl?: string | null },
  actor: string,
): Promise<number> {
  const objectNormalizedName = normalizeName(r.objectName);
  if (!objectNormalizedName) throw new Error("Client name is empty");
  const recordId = await manualRecord(tx, subjectCompanyId);
  const now = new Date();
  const [row] = await tx
    .insert(companyRelations)
    .values({
      subjectCompanyId,
      kind: r.kind,
      objectName: r.objectName.trim(),
      objectNormalizedName,
      objectCompanyId: r.objectCompanyId ?? null,
      source: "manual",
      sourceRecordId: recordId,
      evidenceUrl: r.evidenceUrl ?? null,
      confidence: 1,
      validFrom: now,
      lastSeenAt: now,
    })
    .onConflictDoUpdate({
      target: [companyRelations.subjectCompanyId, companyRelations.kind, companyRelations.objectNormalizedName, companyRelations.source],
      set: { objectName: r.objectName.trim(), objectCompanyId: r.objectCompanyId ?? null, evidenceUrl: r.evidenceUrl ?? null, validTo: null, lastSeenAt: now },
    })
    .returning({ id: companyRelations.id });
  await tx.insert(changes).values({ companyId: subjectCompanyId, sourceRecordId: recordId, source: "manual", kind: "relation_added", attribute: r.kind, newValue: r, actor });
  return row.id;
}

/** Kind: async function. Ends a relation (keeps it as history: valid_to = now). @returns false if already ended. */
export async function endRelation(tx: EngineTx, relationId: number, actor: string): Promise<boolean> {
  const [rel] = await tx
    .update(companyRelations)
    .set({ validTo: new Date() })
    .where(and(eq(companyRelations.id, relationId), isNull(companyRelations.validTo)))
    .returning();
  if (!rel) return false;
  await tx.insert(changes).values({
    companyId: rel.subjectCompanyId,
    source: "manual",
    kind: "relation_ended",
    attribute: rel.kind,
    oldValue: { objectName: rel.objectName, source: rel.source },
    actor,
  });
  return true;
}
