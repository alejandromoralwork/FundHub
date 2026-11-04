/**
 * FILE: services/engine/src/core/normalize.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Small pure helpers that make values comparable across sources:
 *   - normalizeName("ARENDT INVESTOR SERVICES S.A.") === normalizeName("Arendt Investor Services SA")
 *   - normalizeRcs("b 145917") → "B145917"
 *   - parseLuAddress("9, rue de Bitbourg L-1273 Luxembourg") → { street, postcode "1273", city }
 *   - dmyToIso("04/05/2009") → "2009-05-04"; ymdArrayToIso([2009,4,30]) → "2009-04-30"
 *   - canonicalJson / contentHash: a stable hash of parsed data (key order does not matter).
 * WHERE IT RUNS: everywhere; no I/O.
 * TYPESCRIPT YOU WILL SEE HERE: regular expressions, `String.prototype.normalize`, recursion.
 */

import type { Address } from "@fundhub/engine-db/schema";
import { sha256 } from "../storage";

/**
 * Kind: constant. Legal-form words dropped when comparing names (FR/EN/DE spellings, with and without dots).
 * Order matters: longer forms first.
 */
const LEGAL_FORMS = [
  "societe anonyme",
  "public limited company",
  "societe a responsabilite limitee simplifiee",
  "societe a responsabilite limitee",
  "private limited liability company",
  "societe en commandite speciale",
  "societe en commandite simple",
  "societe en commandite par actions",
  "societe cooperative",
  "s a r l s",
  "s a r l",
  "sarl s",
  "sarl",
  "s a",
  "sa",
  "scsp",
  "scs",
  "sca",
  "sicav",
  "sicaf",
  "sicar",
  "raif",
  "sif",
  "asbl",
  "gmbh",
  "ltd",
  "limited",
  "plc",
  "llp",
  "inc",
  "ag",
  "nv",
  "bv",
  "se",
];
const LEGAL_FORM_RE = new RegExp(`\\b(${LEGAL_FORMS.map((f) => f.replace(/ /g, "\\s+")).join("|")})\\b`, "g");

/**
 * Kind: function. Normalizes a company name for matching.
 * @param name  type `string`.
 * @returns `string` — lower case, no accents/punctuation, legal-form words and "(Luxembourg)" removed.
 */
export function normalizeName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // "(Luxembourg)" only in brackets: "Banque de Luxembourg" keeps its last word.
    .replace(/\(\s*luxembourg\s*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(LEGAL_FORM_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Kind: function. Canonical RCS number ("B145917"), or null when it does not look like one.
 * @param v  type `string | null | undefined`.
 */
export function normalizeRcs(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = v.toUpperCase().replace(/[\s.-]/g, "").match(/^([A-Z])0*(\d{1,7})$/);
  return m ? `${m[1]}${m[2]}` : null;
}

/** Kind: function. Splits "B145917" into ["B", 145917]. */
export function splitRcs(rcs: string): [string, number] {
  return [rcs[0], Number(rcs.slice(1))];
}

/** Kind: function. Canonical LEI (20 alphanumerics, upper case) or null. */
export function normalizeLei(v: string | null | undefined): string | null {
  const s = v?.toUpperCase().replace(/\s/g, "");
  return s && /^[A-Z0-9]{20}$/.test(s) ? s : null;
}

/**
 * Kind: function. Parses a one-line Luxembourg address. Recognises "L-1273 Luxembourg" or "1273 Luxembourg".
 * @param raw  type `string`.
 * @returns `Address` — always keeps the raw text.
 */
export function parseLuAddress(raw: string): Address {
  const clean = raw.replace(/\s+/g, " ").trim();
  const m = clean.match(/^(.*?)[,\s]+(?:L-?\s?)?(\d{4})\s+(.+)$/i);
  if (!m) return { raw: clean, country: "LU" };
  return { street: m[1].replace(/,$/, "").trim() || null, postcode: m[2], city: m[3].trim(), country: "LU", raw: clean };
}

/** Kind: function. "04/05/2009" (day/month/year) → "2009-05-04"; null if not a date. */
export function dmyToIso(v: string | null | undefined): string | null {
  const m = v?.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

/** Kind: function. [2009, 4, 30] (the CSSF API format) → "2009-04-30"; null if missing. */
export function ymdArrayToIso(v: unknown): string | null {
  if (!Array.isArray(v) || v.length < 3) return null;
  const [y, m, d] = v as number[];
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * Kind: function. JSON with object keys sorted at every level, so equal data always gives equal text.
 * @param value  type `unknown`.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Kind: function. sha256 of canonicalJson(value) — the "has anything changed?" fingerprint. */
export const contentHash = (value: unknown) => sha256(canonicalJson(value));

/** Kind: function. Deep equality through canonical JSON. */
export const sameValue = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
