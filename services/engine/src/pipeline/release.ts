/**
 * FILE: services/engine/src/pipeline/release.ts
 * PART: scraping engine (services/engine) — pipeline stage B: clean → match → core
 * WHAT IT DOES: Takes ONE parsed version that passed the approval gate (automatically or by a person) and:
 *   1. CLEAN    validates + normalizes it (pipeline/clean.ts); refused values go to clean.rejects;
 *   2. MATCH    resolves the company it is about (core/resolve.ts): identifiers, links, domain, name + postcode;
 *               creates or merges companies; uncertain matches go to match.candidates;
 *   3. WRITE    claims (attribute history, SCD-2), licences, filings, relations, people/positions, web
 *               presence, crawled pages, news article + company mentions;
 *   4. CORE     change events, then consolidate (recomputeCompany: golden fields, lineage, conflicts,
 *               classification), and schedules the next refresh.
 *   Runs inside the caller's transaction with the record + identifier advisory locks, so parallel workers never
 *   create two companies for the same RCS number / LEI.
 * WHERE IT RUNS: engine workers (inline after stage A, or the `staging_release` job after an approval).
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { EngineTx } from "@fundhub/engine-db/client";
import { applyManualEdit, MANUAL_ATTRIBUTES, mergeCompanies, recomputeCompany, type ManualEdit } from "@fundhub/engine-db/core/entity";
import {
  articles,
  candidates,
  changes,
  claims,
  companies,
  companyIdentifiers,
  companyNames,
  companyRelations,
  filings,
  licences,
  parsedRecords,
  people,
  positions,
  rejects,
  sourceRecords,
  sources,
  webPages,
  webPresence,
  type EngineSource,
  type IdScheme,
  type MatchMethod,
} from "@fundhub/engine-db/schema";
import { diffRecords, type Change } from "../core/diff";
import { normalizeName, sameValue } from "../core/normalize";
import { resolveRecord, STRONG_SCHEMES, type ResolverStore } from "../core/resolve";
import type { ParsedRecord } from "../core/types";
import { cleanRecord, domainOf } from "./clean";
import { detectMentions } from "./mentions";

// ------------------------------------------------------------------ refresh policy

let refreshCache: { at: number; rows: Map<string, [number, number, number] | null> } | null = null;

/** Kind: async function. Days until a record is fetched again, from ops.sources.refresh_days by company tier. */
export async function refreshDays(tx: EngineTx, source: EngineSource, tier: number): Promise<number | null> {
  if (!refreshCache || Date.now() - refreshCache.at > 300_000) {
    const rows = await tx.select({ code: sources.code, refreshDays: sources.refreshDays }).from(sources);
    refreshCache = { at: Date.now(), rows: new Map(rows.map((r) => [r.code, r.refreshDays])) };
  }
  const d = refreshCache.rows.get(source);
  return d ? d[Math.max(0, Math.min(2, tier))] : null;
}
export const daysFromNow = (d: number | null) => (d === null ? null : new Date(Date.now() + d * 86_400_000));

// ------------------------------------------------------------------ resolver store (database side)

/** Kind: class. ResolverStore backed by the Intelligence DB, inside the current transaction. */
export class DbResolverStore implements ResolverStore {
  constructor(
    private tx: EngineTx,
    private sourceRecordId: number,
    private source: EngineSource,
  ) {}

  async findByIdentifier(scheme: IdScheme, value: string) {
    const [r] = await this.tx.select({ id: companyIdentifiers.companyId }).from(companyIdentifiers).where(and(eq(companyIdentifiers.scheme, scheme), eq(companyIdentifiers.value, value)));
    return r?.id ?? null;
  }
  async findByName(normalizedName: string) {
    return this.tx
      .select({ companyId: companies.id, postcode: sql<string | null>`${companies.registeredAddress}->>'postcode'` })
      .from(companies)
      .where(eq(companies.normalizedName, normalizedName))
      .limit(10);
  }
  async exists(companyId: string) {
    const [r] = await this.tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
    return !!r;
  }
  async createCompany(seed: { canonicalName: string; normalizedName: string }) {
    const [r] = await this.tx.insert(companies).values(seed).returning({ id: companies.id });
    return r.id;
  }
  async addIdentifiers(companyId: string, ids: { scheme: IdScheme; value: string }[], source: EngineSource) {
    if (!ids.length) return;
    await this.tx
      .insert(companyIdentifiers)
      .values(ids.map((i) => ({ companyId, scheme: i.scheme, value: i.value, source })))
      .onConflictDoNothing();
  }
  async merge(keep: string, drop: string) {
    await mergeCompanies(this.tx, keep, drop, this.source);
  }
  async addCandidate(companyId: string, method: MatchMethod, score: number, decision: "auto" | "pending") {
    await this.tx.insert(candidates).values({ sourceRecordId: this.sourceRecordId, companyId, method, score, decision }).onConflictDoNothing();
  }
}

/**
 * Kind: async function. Would this record create a NEW company? (Used by the gate before anything is written.)
 * False when it is already linked / targeted, or any identifier, domain or unique name + postcode matches.
 */
export async function wouldCreateCompany(tx: EngineTx, rec: ParsedRecord, linkedCompanyId: string | null): Promise<boolean> {
  if (rec.state !== "found" || rec.source === "news") return false;
  if (linkedCompanyId || rec.targetCompanyId) return false;
  const store = new DbResolverStore(tx, 0, rec.source);
  for (const i of rec.identifiers) if (await store.findByIdentifier(i.scheme, i.value)) return false;
  const name = normalizeName(rec.facts.name ?? "");
  if (name.length >= 3) {
    const same = await store.findByName(name);
    const pc = rec.facts.address?.postcode ?? null;
    if (pc && same.filter((s) => s.postcode === pc).length === 1) return false;
  }
  return true;
}

// ------------------------------------------------------------------ writers

/** Kind: async function. SCD-2 update of one record's claims: close changed rows, open new ones. */
async function writeClaims(tx: EngineTx, rec: ParsedRecord, sourceRecordId: number, companyId: string | null, parsedRecordId: number) {
  const open = await tx.select().from(claims).where(and(eq(claims.sourceRecordId, sourceRecordId), isNull(claims.validTo)));
  const byAttr = new Map(open.map((o) => [o.attribute, o]));
  const now = new Date();
  const confidence = rec.confidence ?? 1;
  for (const [attribute, value] of Object.entries(rec.facts)) {
    if (value === undefined) continue;
    const o = byAttr.get(attribute);
    byAttr.delete(attribute);
    if (o && sameValue(o.value, value)) continue;
    if (o) await tx.update(claims).set({ validTo: now }).where(eq(claims.id, o.id));
    await tx.insert(claims).values({ companyId, sourceRecordId, source: rec.source, attribute, value, confidence, parsedRecordId, validFrom: now });
  }
  const gone = [...byAttr.values()].map((o) => o.id);
  if (gone.length) await tx.update(claims).set({ validTo: now }).where(inArray(claims.id, gone));
  await tx.update(claims).set({ companyId }).where(eq(claims.sourceRecordId, sourceRecordId));
}

/** Kind: async function. Names, CSSF licences, LBR filings, crawled pages. */
async function writeDetails(tx: EngineTx, rec: ParsedRecord, sourceRecordId: number, companyId: string) {
  for (const n of rec.names) {
    await tx
      .insert(companyNames)
      .values({ companyId, name: n.name, kind: n.kind, source: rec.source, validFrom: n.validFrom })
      .onConflictDoUpdate({ target: [companyNames.companyId, companyNames.source, companyNames.name], set: { kind: n.kind, validFrom: n.validFrom } });
  }
  if (rec.licences) {
    const now = new Date();
    for (const d of rec.licences) {
      await tx
        .insert(licences)
        .values({ sourceRecordId, ...d })
        .onConflictDoUpdate({
          target: [licences.sourceRecordId, licences.detailType, licences.code],
          set: { kind: d.kind, label: d.label, lei: d.lei, startDate: d.startDate, endDate: d.endDate, lastSeenAt: now },
        });
    }
    // Lines that vanished from the register: close them (end date = today) instead of deleting history.
    const keep = rec.licences.map((d) => `${d.detailType}:${d.code}`);
    await tx.execute(sql`
      update clean.licences set end_date = coalesce(end_date, current_date)
      where source_record_id = ${sourceRecordId}
        and (detail_type || ':' || code) not in (select jsonb_array_elements_text(${JSON.stringify(keep)}::jsonb))`);
  }
  await writeFilings(tx, sourceRecordId, rec);
  for (const p of rec.pages ?? []) {
    await tx
      .insert(webPages)
      .values({ sourceRecordId, url: p.url, kind: p.kind, title: p.title, textBlobKey: p.textBlobKey })
      .onConflictDoUpdate({ target: [webPages.sourceRecordId, webPages.url], set: { kind: p.kind, title: p.title, textBlobKey: p.textBlobKey, lastSeenAt: new Date() } });
  }
}

/**
 * Kind: async function. Relations (clients…): upsert what the record states, link each client to its company
 * when exactly one has that normalized name, end what this source no longer states.
 */
async function writeRelations(tx: EngineTx, rec: ParsedRecord, sourceRecordId: number, companyId: string) {
  if (!rec.relations) return;
  const now = new Date();
  const keys: string[] = [];
  for (const r of rec.relations) {
    const objectNormalizedName = normalizeName(r.objectName);
    if (!objectNormalizedName) continue;
    keys.push(`${r.kind}:${objectNormalizedName}`);
    const matches = await tx.select({ id: companies.id }).from(companies).where(eq(companies.normalizedName, objectNormalizedName)).limit(2);
    const objectCompanyId = matches.length === 1 && matches[0].id !== companyId ? matches[0].id : null;
    await tx
      .insert(companyRelations)
      .values({ subjectCompanyId: companyId, kind: r.kind, objectName: r.objectName, objectNormalizedName, objectCompanyId, source: rec.source, sourceRecordId, evidenceUrl: r.evidenceUrl, confidence: r.confidence, validFrom: now, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [companyRelations.subjectCompanyId, companyRelations.kind, companyRelations.objectNormalizedName, companyRelations.source],
        set: { objectName: r.objectName, evidenceUrl: r.evidenceUrl, confidence: r.confidence, lastSeenAt: now, validTo: null, objectCompanyId: sql`coalesce(${companyRelations.objectCompanyId}, ${objectCompanyId})` },
      });
  }
  await tx.execute(sql`
    update core.company_relations set valid_to = ${now}
    where subject_company_id = ${companyId} and source = ${rec.source} and valid_to is null
      and (kind || ':' || object_normalized_name) not in (select jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))`);
}

/**
 * Kind: async function. People and their positions at the company. A person is matched by profile URL, else
 * by normalized name among people already working at this company (names alone are not unique).
 * @returns changes for new / ended positions.
 */
async function writePeople(tx: EngineTx, rec: ParsedRecord, sourceRecordId: number, companyId: string): Promise<Change[]> {
  if (!rec.people) return [];
  const now = new Date();
  const out: Change[] = [];
  const kept: number[] = [];
  for (const p of rec.people) {
    const normalized = normalizeName(p.fullName);
    let personId: string | undefined;
    if (p.profileUrl) personId = (await tx.select({ id: people.id }).from(people).where(eq(people.profileUrl, p.profileUrl)))[0]?.id;
    if (!personId) {
      const [same] = await tx
        .select({ id: people.id })
        .from(people)
        .innerJoin(positions, eq(positions.personId, people.id))
        .where(and(eq(people.normalizedName, normalized), eq(positions.companyId, companyId)))
        .limit(1);
      personId = same?.id;
    }
    if (!personId) [{ id: personId }] = await tx.insert(people).values({ fullName: p.fullName, normalizedName: normalized, profileUrl: p.profileUrl ?? null }).returning({ id: people.id });
    else await tx.update(people).set({ lastSeenAt: now, ...(p.profileUrl ? { profileUrl: p.profileUrl } : {}) }).where(eq(people.id, personId));

    const [row] = await tx
      .insert(positions)
      .values({ personId, companyId, title: p.title, role: p.role, source: rec.source, sourceRecordId, evidenceUrl: p.evidenceUrl ?? null, validFrom: now, lastSeenAt: now })
      .onConflictDoUpdate({ target: [positions.personId, positions.companyId, positions.title, positions.source], set: { role: p.role, evidenceUrl: p.evidenceUrl ?? null, lastSeenAt: now, validTo: null } })
      .returning({ id: positions.id, validFrom: positions.validFrom });
    kept.push(row.id);
    if (row.validFrom.getTime() === now.getTime()) out.push({ kind: "position_added", attribute: p.role, newValue: { name: p.fullName, title: p.title } });
  }
  const ended = await tx
    .update(positions)
    .set({ validTo: now })
    .where(and(eq(positions.companyId, companyId), eq(positions.source, rec.source), isNull(positions.validTo), kept.length ? sql`${positions.id} not in ${kept}` : sql`true`))
    .returning({ title: positions.title, role: positions.role });
  for (const e of ended) out.push({ kind: "position_ended", attribute: e.role, oldValue: { title: e.title } });
  return out;
}

/** Kind: async function. Website and social profiles; also records the website domain as an identifier. */
async function writeWebPresence(tx: EngineTx, rec: ParsedRecord, companyId: string) {
  const now = new Date();
  const rows = [...(rec.webPresence ?? [])];
  if (rec.facts.website && !rows.some((w) => w.platform === "website")) rows.push({ platform: "website", url: rec.facts.website, verified: !!rec.facts.websiteVerifiedAt });
  for (const w of rows) {
    await tx
      .insert(webPresence)
      .values({ companyId, platform: w.platform, url: w.url, handle: w.handle ?? null, followers: w.followers ?? null, verified: w.verified ?? false, source: rec.source, lastSeenAt: now })
      .onConflictDoUpdate({
        target: [webPresence.companyId, webPresence.platform, webPresence.url],
        set: { handle: w.handle ?? null, followers: sql`coalesce(${w.followers ?? null}::int, ${webPresence.followers})`, verified: sql`${webPresence.verified} or ${w.verified ?? false}`, lastSeenAt: now },
      });
  }
  // A verified website's domain becomes an identifier, so other sources (social profiles, news) can match on it.
  const domain = rec.facts.websiteVerifiedAt ? domainOf(rec.facts.website) : null;
  if (domain) await tx.insert(companyIdentifiers).values({ companyId, scheme: "domain", value: domain, source: rec.source }).onConflictDoNothing();
}

/** Kind: async function. A news article and the companies it mentions (core.news_mentions). */
async function writeArticle(tx: EngineTx, rec: ParsedRecord, sourceRecordId: number): Promise<number> {
  const a = rec.article;
  if (!a) return 0;
  const [art] = await tx
    .insert(articles)
    .values({ sourceRecordId, feedId: a.feedId, url: a.url, title: a.title, publishedAt: a.publishedAt ? new Date(a.publishedAt) : null, author: a.author, language: a.language, snippet: a.snippet, textBlobKey: a.textBlobKey })
    .onConflictDoUpdate({ target: articles.url, set: { title: a.title, snippet: a.snippet, textBlobKey: a.textBlobKey } })
    .returning({ id: articles.id });
  return detectMentions(tx, art.id, a.matchText, rec.targetCompanyId ?? null);
}

// ------------------------------------------------------------------ stage B

/** Kind: type alias. Result of releasing one parsed version. */
export type ReleaseResult = { companyId: string | null; created: boolean; changes: number; rejects: number; mentions: number };

/**
 * Kind: async function. Runs clean → match → core for a parsed version that passed the gate.
 * @param prev      the previously released payload (for change detection), or null.
 * @param manual    staff corrections made at the gate ("edit and approve"), applied as manual claims.
 */
export async function releaseParsed(
  tx: EngineTx,
  args: { parsedId: number; sourceRecordId: number; rec: ParsedRecord; prev: ParsedRecord | null; linkedCompanyId: string | null; contentHash: string; actor?: string; manual?: ManualEdit },
): Promise<ReleaseResult> {
  const { parsedId, sourceRecordId } = args;

  // 1. CLEAN
  const { record: rec, rejects: refused } = cleanRecord(args.rec);
  if (refused.length) {
    await tx.insert(rejects).values(refused.map((r) => ({ sourceRecordId, parsedRecordId: parsedId, source: rec.source, attribute: r.attribute, value: r.value ?? null, reason: r.reason })));
  }
  const now = new Date();
  const finish = async (companyId: string | null) => {
    await tx.update(sourceRecords).set({ companyId, releasedParsedId: parsedId, released: rec as unknown as Record<string, unknown>, contentHash: args.contentHash, lastChangedAt: now }).where(eq(sourceRecords.id, sourceRecordId));
    await tx.update(parsedRecords).set({ releasedAt: now }).where(eq(parsedRecords.id, parsedId));
  };

  // News articles are about several companies: no single company to resolve.
  if (rec.source === "news") {
    const mentions = await writeArticle(tx, rec, sourceRecordId);
    await finish(null);
    return { companyId: null, created: false, changes: 0, rejects: refused.length, mentions };
  }

  // 2. MATCH — lock every strong identifier (sorted, to avoid deadlocks) before resolving.
  const idKeys = rec.identifiers.filter((i) => STRONG_SCHEMES.includes(i.scheme)).map((i) => `id:${i.scheme}:${i.value}`).sort();
  for (const k of idKeys) await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${k}))`);
  const res = await resolveRecord(rec, new DbResolverStore(tx, sourceRecordId, rec.source), args.linkedCompanyId);

  // 3. WRITE
  await writeClaims(tx, rec, sourceRecordId, res.companyId, parsedId);
  await writeDetails(tx, rec, sourceRecordId, res.companyId);
  await writeRelations(tx, rec, sourceRecordId, res.companyId);
  const peopleChanges = await writePeople(tx, rec, sourceRecordId, res.companyId);
  await writeWebPresence(tx, rec, res.companyId);
  const mentions = rec.article ? await writeArticle(tx, rec, sourceRecordId) : 0;

  // 4. CORE — change feed, then consolidate.
  const events: Change[] = [...diffRecords(args.prev, rec), ...peopleChanges];
  if (res.created) events.unshift({ kind: "new_company", newValue: { name: rec.facts.name ?? null, via: rec.source } });
  if (events.length) {
    await tx.insert(changes).values(
      events.map((c) => ({ companyId: res.companyId, sourceRecordId, source: rec.source, kind: c.kind, attribute: c.attribute ?? null, oldValue: c.oldValue ?? null, newValue: c.newValue ?? null, actor: args.actor ?? null })),
    );
  }
  await finish(res.companyId);
  await recomputeCompany(tx, res.companyId);

  // Corrections made at the gate become staff ("manual") claims: they win, keep history, and can be cleared.
  if (args.manual && Object.keys(args.manual).length) await applyManualEdit(tx, res.companyId, args.manual, undefined, args.actor ?? "staff:unknown");

  const [after] = await tx.select({ tier: companies.tier }).from(companies).where(eq(companies.id, res.companyId));
  await tx.update(sourceRecords).set({ nextFetchAt: daysFromNow(await refreshDays(tx, rec.source, after?.tier ?? 0)) }).where(eq(sourceRecords.id, sourceRecordId));
  return { companyId: res.companyId, created: res.created, changes: events.length, rejects: refused.length, mentions };
}

/**
 * Kind: function. Splits a reviewer's edited payload into (a) the record to release — the source's own claims
 *   stay the source's, so provenance stays true — and (b) manual corrections for golden attributes.
 *   Lists (people, relations, web presence…) are taken from the edited payload: a reviewer removing a wrong
 *   person or client means the source's statement is not accepted.
 */
export function splitEdit(original: ParsedRecord, edited: ParsedRecord): { rec: ParsedRecord; manual: ManualEdit } {
  const manual: Record<string, unknown> = {};
  const facts = { ...original.facts };
  for (const [k, v] of Object.entries(edited.facts ?? {})) {
    if (sameValue(original.facts[k], v)) continue;
    if ((MANUAL_ATTRIBUTES as readonly string[]).includes(k)) manual[k] = v;
    else facts[k] = v;
  }
  for (const k of Object.keys(original.facts)) if (!(k in (edited.facts ?? {})) && !(MANUAL_ATTRIBUTES as readonly string[]).includes(k)) delete facts[k];
  return { rec: { ...edited, facts }, manual: manual as ManualEdit };
}

/**
 * Kind: async function. Upserts the LBR filings list of a record (clean.filings). Also used for a version HELD at
 * the approval gate: the filings list is factual and append-only (filings are never deleted), and its documents
 * can only be saved once the filings are known; the legal facts of the held version still wait for review.
 */
export async function writeFilings(tx: EngineTx, sourceRecordId: number, rec: ParsedRecord) {
  for (const f of rec.filings ?? []) {
    await tx
      .insert(filings)
      .values({ sourceRecordId, ...f })
      .onConflictDoUpdate({ target: filings.filingNumber, set: { correctedBy: f.correctedBy, corrects: f.corrects, details: f.details, hasDocuments: f.hasDocuments } });
  }
}
