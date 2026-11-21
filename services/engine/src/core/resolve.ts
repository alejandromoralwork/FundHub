/**
 * FILE: services/engine/src/core/resolve.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Company resolution — decides which golden entity a source record belongs to.
 *   1. Strong identifiers first (RCS number, LEI, CSSF code/id). GLEIF records carry BOTH an LEI and the RCS
 *      number ("registeredAs"), which bridges CSSF (has LEI) and RCS (has the number) deterministically.
 *   2. If the identifiers point to two different companies, they are the same company found twice → merge.
 *   3. No identifier match → look for the same normalized name. Same name + same postcode = automatic link;
 *      same name only = a NEW entity plus a "pending" match candidate for a person to confirm (we never
 *      merge on a name alone, and every record still gets an entity, so the census stays complete).
 *   The database side is behind `ResolverStore`, so this logic is tested with an in-memory store.
 * WHERE IT RUNS: called by core/ingest.ts inside a transaction holding advisory locks on the identifiers.
 * TYPESCRIPT YOU WILL SEE HERE: `interface`, `Promise<…>`, `Set`, ordering by a ranking list.
 */

import type { EngineSource, IdScheme, MatchMethod } from "@fundhub/engine-db/schema";
import { normalizeName } from "./normalize";
import type { ParsedRecord } from "./types";

/** Kind: constant. Identifier schemes strong enough to link or merge on, in trust order. */
export const STRONG_SCHEMES: IdScheme[] = ["rcs", "lei", "cssf_code", "cssf_id", "fundhub_provider"];

/** Kind: interface. Database operations the resolver needs. */
export interface ResolverStore {
  findByIdentifier(scheme: IdScheme, value: string): Promise<string | null>;
  /** Entities with this normalized name, with their registered postcode. */
  findByName(normalizedName: string): Promise<{ companyId: string; postcode: string | null }[]>;
  createCompany(seed: { canonicalName: string; normalizedName: string }): Promise<string>;
  /** True when the company still exists (a target id may point at a company merged away since). */
  exists(companyId: string): Promise<boolean>;
  addIdentifiers(companyId: string, ids: { scheme: IdScheme; value: string }[], source: EngineSource): Promise<void>;
  /** Moves everything from `drop` to `keep` and deletes `drop`. */
  merge(keep: string, drop: string): Promise<void>;
  addCandidate(companyId: string, method: MatchMethod, score: number, decision: "auto" | "pending"): Promise<void>;
}

/** Kind: type alias. Outcome of resolving one record. */
export type Resolution = { companyId: string; created: boolean; method: MatchMethod | "new" | "linked"; merged: string[] };

/**
 * Kind: async function. Resolves a parsed record to an entity id (creating or merging as needed).
 * @param rec    type `ParsedRecord`.
 * @param store  type `ResolverStore`.
 * @param linkedEntityId  the company the source record is already linked to, if any (kept unless ids disagree).
 *   When absent, `rec.targetCompanyId` (the company a website crawl / news search was run for) is used.
 * @returns `Promise<Resolution>`.
 */
export async function resolveRecord(rec: ParsedRecord, store: ResolverStore, linkedCompanyId: string | null = null): Promise<Resolution> {
  let linkedEntityId = linkedCompanyId;
  if (!linkedEntityId && rec.targetCompanyId && (await store.exists(rec.targetCompanyId))) linkedEntityId = rec.targetCompanyId;
  const strong = rec.identifiers.filter((i) => STRONG_SCHEMES.includes(i.scheme)).sort((a, b) => STRONG_SCHEMES.indexOf(a.scheme) - STRONG_SCHEMES.indexOf(b.scheme));

  // 1. Every entity any strong identifier points to, in trust order.
  const hits: { companyId: string; scheme: IdScheme }[] = [];
  for (const id of strong) {
    const e = await store.findByIdentifier(id.scheme, id.value);
    if (e && !hits.some((h) => h.companyId === e)) hits.push({ companyId: e, scheme: id.scheme });
  }

  // Already linked and no identifier says otherwise → keep the link.
  if (hits.length === 0 && linkedEntityId) {
    await store.addIdentifiers(linkedEntityId, rec.identifiers, rec.source);
    return { companyId: linkedEntityId, created: false, method: "linked", merged: [] };
  }

  if (hits.length > 0) {
    const keep = hits[0].companyId;
    const merged: string[] = [];
    // 2. Several companies for one real company (including the record's previous link) → merge them into
    //    the most trusted hit.
    const others = hits.slice(1).map((h) => h.companyId);
    if (linkedEntityId && linkedEntityId !== keep && !others.includes(linkedEntityId)) others.push(linkedEntityId);
    for (const drop of others) {
      await store.merge(keep, drop);
      merged.push(drop);
    }
    await store.addIdentifiers(keep, rec.identifiers, rec.source);
    const scheme = hits[0].scheme;
    const method: MatchMethod =
      scheme === "rcs" ? "rcs_exact" : scheme === "lei" ? (rec.source === "gleif" ? "gleif_bridge" : "lei_exact") : scheme === "fundhub_provider" ? "fundhub_exact" : "cssf_exact";
    return { companyId: keep, created: false, method, merged };
  }

  // 3. A verified website domain (only websites confirmed by their legal notice are stored as identifiers).
  for (const d of rec.identifiers.filter((i) => i.scheme === "domain")) {
    const companyId = await store.findByIdentifier("domain", d.value);
    if (companyId) {
      await store.addIdentifiers(companyId, rec.identifiers, rec.source);
      await store.addCandidate(companyId, "domain_exact", 0.9, "auto");
      return { companyId, created: false, method: "domain_exact", merged: [] };
    }
  }

  // 4. Name matching.
  const name = rec.facts.name ?? rec.externalId;
  const normalizedName = normalizeName(name);
  const postcode = (rec.facts.address as { postcode?: string | null } | null | undefined)?.postcode ?? null;
  const sameName = normalizedName.length >= 3 ? await store.findByName(normalizedName) : [];
  const samePlace = postcode ? sameName.filter((c) => c.postcode === postcode) : [];

  if (samePlace.length === 1) {
    const companyId = samePlace[0].companyId;
    await store.addIdentifiers(companyId, rec.identifiers, rec.source);
    await store.addCandidate(companyId, "name_postcode", 0.95, "auto");
    return { companyId, created: false, method: "name_postcode", merged: [] };
  }

  const companyId = await store.createCompany({ canonicalName: name, normalizedName });
  await store.addIdentifiers(companyId, rec.identifiers, rec.source);
  // Possible duplicates go to review; linking happens when a person accepts (or an identifier proves it).
  for (const c of sameName) await store.addCandidate(c.companyId, "name_only", 0.7, "pending");
  return { companyId, created: true, method: "new", merged: [] };
}
