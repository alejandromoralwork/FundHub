/**
 * FILE: packages/engine-db/src/core/golden.ts
 * PART: shared package (packages/engine-db) — engine core, used by the engine workers and the admin console
 * WHAT IT DOES: Builds the golden record of an entity from what each source currently says about it.
 *   For every attribute there is a ranking of sources (the official register first): e.g. the name comes
 *   from RCS if we have it, else CSSF, else GLEIF, else the website. Pure function — easy to test and tune.
 * WHERE IT RUNS: called by core/ingest.ts after observations change.
 * TYPESCRIPT YOU WILL SEE HERE: `Record<K, V>`, `Partial<T>`, `find`.
 */

import type { Address, EngineSource, EntityStatus, Logo } from "../schema";

/** Kind: constant. Source precedence per golden attribute (first = most trusted). "manual" = a staff edit in the admin console: it always wins, and clearing it lets the registers take over again. */
export const PRECEDENCE: Record<string, EngineSource[]> = {
  name: ["manual", "rcs", "lbr_bulk", "cssf", "gleif", "web"],
  legalForm: ["manual", "rcs", "lbr_bulk", "gleif", "cssf"],
  status: ["manual", "rcs", "lbr_bulk", "gleif", "cssf"],
  address: ["manual", "rcs", "lbr_bulk", "cssf", "gleif", "web"],
  registrationDate: ["manual", "rcs", "lbr_bulk", "gleif"],
  lei: ["manual", "gleif", "cssf"],
  rcsNumber: ["manual", "rcs", "lbr_bulk", "gleif"],
  website: ["manual", "web", "gleif", "cssf"],
  websiteVerifiedAt: ["manual", "web"],
  operatingCountries: ["manual", "web"],
  logo: ["manual", "web"],
};

/** Kind: type alias. One current claim: source + attribute + value. */
export type Claim = { source: EngineSource; attribute: string; value: unknown };

/** Kind: type alias. The golden fields written to `entities`. */
export type Golden = {
  canonicalName?: string;
  legalForm?: string | null;
  status?: EntityStatus;
  rcsNumber?: string | null;
  lei?: string | null;
  registeredAddress?: Address | null;
  registrationDate?: string | null;
  website?: string | null;
  websiteVerifiedAt?: string | null;
  operatingCountries?: string[];
  logo?: Logo | null;
};

/**
 * Kind: function. Picks each golden field from the claims by precedence. Null/empty values are skipped, so a
 * lower-ranked source fills a gap left by a higher-ranked one.
 * @param claims  type `Claim[]` — the open observations of all source records linked to the entity.
 * @returns `Golden` — only the fields some source provided.
 */
export function buildGolden(claims: Claim[]): Golden {
  const pick = (attribute: string): unknown => {
    for (const source of PRECEDENCE[attribute]) {
      const c = claims.find(
        (x) => x.source === source && x.attribute === attribute && x.value !== null && x.value !== "" && x.value !== undefined && !(Array.isArray(x.value) && x.value.length === 0),
      );
      if (c) return c.value;
    }
    return undefined;
  };
  const g: Golden = {};
  const name = pick("name");
  if (typeof name === "string") g.canonicalName = name;
  const set = <K extends keyof Golden>(key: K, attribute: string) => {
    const v = pick(attribute);
    if (v !== undefined) g[key] = v as Golden[K];
  };
  set("legalForm", "legalForm");
  set("rcsNumber", "rcsNumber");
  set("lei", "lei");
  set("registeredAddress", "address");
  set("registrationDate", "registrationDate");
  set("website", "website");
  set("websiteVerifiedAt", "websiteVerifiedAt");
  set("operatingCountries", "operatingCountries");
  set("logo", "logo");
  // "unknown" never overrides a real status from a lower-ranked source.
  const status = PRECEDENCE.status.map((s) => claims.find((c) => c.source === s && c.attribute === "status")?.value).find((v) => v && v !== "unknown");
  if (status) g.status = status as EntityStatus;
  return g;
}
