/**
 * FILE: packages/engine-db/src/core/golden.ts
 * PART: shared package (packages/engine-db) — pipeline stage "consolidate" (pure part)
 * WHAT IT DOES: Turns the current claims of every source about one company into:
 *   - the GOLDEN values (each field from the most trusted source that states it — ops.attribute_precedence),
 *   - the LINEAGE of each field (which claim won, how many sources agree),
 *   - the CONFLICTS: fields where two or more sources state different values (after normalization).
 *   "manual" (a staff edit) always wins and never counts as a conflict. Pure: no database access, so it is
 *   tested on plain data (test/core.test.ts) and used by entity.ts recomputeCompany().
 * WHERE IT RUNS: anywhere (engine workers, admin console, tests).
 */

import type { Address, CompanyStatus, EngineSource, Logo } from "../schema";
import { PRECEDENCE as DEFAULT_PRECEDENCE } from "../seed-data";
import { normalizeName, sameValue } from "./normalize";

/** Kind: type alias. Attribute → sources allowed, most trusted first (from ops.attribute_precedence). */
export type Precedence = Record<string, EngineSource[]>;

/** Kind: constant. The seed-data precedence with "manual" in front — the fallback when the table is empty. */
export const PRECEDENCE: Precedence = Object.fromEntries(Object.entries(DEFAULT_PRECEDENCE).map(([a, list]) => [a, ["manual", ...list]]));

/** Kind: type alias. One current claim: source + attribute + value (+ its clean.claims id when known). */
export type Claim = { id?: number; source: EngineSource; attribute: string; value: unknown };

/** Kind: type alias. The golden fields written to core.companies (keys are column names in TypeScript). */
export type Golden = {
  canonicalName?: string;
  legalForm?: string | null;
  status?: CompanyStatus;
  rcsNumber?: string | null;
  lei?: string | null;
  registeredAddress?: Address | null;
  registrationDate?: string | null;
  website?: string | null;
  websiteVerifiedAt?: string | null;
  description?: string | null;
  phone?: string | null;
  email?: string | null;
  headcount?: number | null;
  foundedYear?: number | null;
  operatingCountries?: string[];
  services?: string[];
  logo?: Logo | null;
};

/** Kind: constant. Claim attribute → golden column. */
export const GOLDEN_FIELD: Record<string, keyof Golden> = {
  name: "canonicalName",
  legalForm: "legalForm",
  status: "status",
  rcsNumber: "rcsNumber",
  lei: "lei",
  address: "registeredAddress",
  registrationDate: "registrationDate",
  website: "website",
  websiteVerifiedAt: "websiteVerifiedAt",
  description: "description",
  phone: "phone",
  email: "email",
  headcount: "headcount",
  foundedYear: "foundedYear",
  operatingCountries: "operatingCountries",
  services: "services",
  logo: "logo",
};

/** Kind: constant. Attributes where disagreement between sources is worth a person's attention. */
/**
 * Kind: constant. Attributes where a disagreement between sources opens a conflict for a person to check.
 * Name and address are NOT here on purpose: they follow strict precedence (LBR first, then CSSF, then the rest,
 * ops.attribute_precedence) with no manual check; the disagreement stays visible in the field lineage
 * (sources agreeing / total).
 */
export const CONFLICT_ATTRIBUTES = ["legalForm", "status", "rcsNumber", "lei", "registrationDate", "website"];

/** Kind: type alias. Lineage of one golden field. */
export type Lineage = { attribute: string; claimId: number | null; source: EngineSource; value: unknown; sourcesAgreeing: number; sourcesTotal: number };
/** Kind: type alias. One detected disagreement. */
export type ConflictFound = { attribute: string; values: { source: EngineSource; value: unknown }[]; winner: EngineSource };
/** Kind: type alias. Everything consolidate() produces. */
export type Consolidated = { golden: Golden; lineage: Lineage[]; conflicts: ConflictFound[]; sourceCount: number };

const isEmpty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0) || v === "unknown";

/**
 * Kind: function. The comparison key of a value, so that cosmetic differences are not conflicts:
 * names by normalizeName(), addresses by postcode, websites by host without "www.".
 */
export function comparable(attribute: string, v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (attribute === "name" && typeof v === "string") return normalizeName(v);
  if (attribute === "address" && typeof v === "object") return ((v as Address).postcode ?? (v as Address).raw ?? "").replace(/\s/g, "").toUpperCase();
  if (attribute === "website" && typeof v === "string") {
    try {
      return new URL(v.startsWith("http") ? v : `https://${v}`).hostname.replace(/^www\./, "");
    } catch {
      return v.toLowerCase();
    }
  }
  if (attribute === "legalForm" && typeof v === "string") return v.toLowerCase().replace(/[^a-z]/g, "");
  return v;
}

/**
 * Kind: function. Consolidates the claims of one company.
 * @param claims      the open claims of all source records linked to the company.
 * @param precedence  from ops.attribute_precedence (loadPrecedence() in entity.ts); defaults to the seed.
 */
export function consolidate(claims: Claim[], precedence: Precedence = PRECEDENCE): Consolidated {
  const golden: Golden = {};
  const lineage: Lineage[] = [];
  const conflicts: ConflictFound[] = [];

  for (const [attribute, field] of Object.entries(GOLDEN_FIELD)) {
    const order = precedence[attribute] ?? [];
    const stated = claims.filter((c) => c.attribute === attribute && !isEmpty(c.value) && order.includes(c.source));
    if (!stated.length) continue;
    // Winner: the first source in precedence order that states a value.
    let win: Claim | undefined;
    for (const s of order) {
      win = stated.find((c) => c.source === s);
      if (win) break;
    }
    if (!win) continue;
    (golden as Record<string, unknown>)[field] = win.value;

    const bySource = new Map<EngineSource, unknown>();
    for (const c of stated) if (c.source !== "manual" && !bySource.has(c.source)) bySource.set(c.source, c.value);
    const winKey = comparable(attribute, win.value);
    const agreeing = [...bySource.values()].filter((v) => sameValue(comparable(attribute, v), winKey)).length;
    lineage.push({ attribute, claimId: win.id ?? null, source: win.source, value: win.value, sourcesAgreeing: Math.max(agreeing, 1), sourcesTotal: Math.max(bySource.size, 1) });

    if (CONFLICT_ATTRIBUTES.includes(attribute) && bySource.size >= 2) {
      const keys = new Set([...bySource.values()].map((v) => JSON.stringify(comparable(attribute, v))));
      if (keys.size > 1) conflicts.push({ attribute, values: [...bySource].map(([source, value]) => ({ source, value })), winner: win.source });
    }
  }

  const sourceCount = new Set(claims.filter((c) => c.source !== "manual").map((c) => c.source)).size;
  return { golden, lineage, conflicts, sourceCount };
}

/** Kind: function. Golden values only (kept for callers that need nothing else). */
export function buildGolden(claims: Claim[], precedence: Precedence = PRECEDENCE): Golden {
  return consolidate(claims, precedence).golden;
}
