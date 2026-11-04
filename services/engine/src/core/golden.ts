/**
 * FILE: services/engine/src/core/golden.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Builds the golden record of an entity from what each source currently says about it.
 *   For every attribute there is a ranking of sources (the official register first): e.g. the name comes
 *   from RCS if we have it, else CSSF, else GLEIF, else the website. Pure function — easy to test and tune.
 * WHERE IT RUNS: called by core/ingest.ts after observations change.
 * TYPESCRIPT YOU WILL SEE HERE: `Record<K, V>`, `Partial<T>`, `find`.
 */

import type { Address, EngineSource, EntityStatus } from "@fundhub/engine-db/schema";

/** Kind: constant. Source precedence per golden attribute (first = most trusted). */
export const PRECEDENCE: Record<string, EngineSource[]> = {
  name: ["rcs", "cssf", "gleif", "web"],
  legalForm: ["rcs", "gleif", "cssf"],
  status: ["rcs", "gleif", "cssf"],
  address: ["rcs", "cssf", "gleif", "web"],
  registrationDate: ["rcs", "gleif"],
  lei: ["gleif", "cssf"],
  rcsNumber: ["rcs", "gleif"],
  website: ["web", "gleif", "cssf"],
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
      const c = claims.find((x) => x.source === source && x.attribute === attribute && x.value !== null && x.value !== "" && x.value !== undefined);
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
  // "unknown" never overrides a real status from a lower-ranked source.
  const status = PRECEDENCE.status.map((s) => claims.find((c) => c.source === s && c.attribute === "status")?.value).find((v) => v && v !== "unknown");
  if (status) g.status = status as EntityStatus;
  return g;
}
