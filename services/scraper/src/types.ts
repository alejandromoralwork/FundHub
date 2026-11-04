/**
 * FILE: services/scraper/src/types.ts
 * PART: scraper (services/scraper)
 * WHAT IT DOES: Defines the shapes of data shared by every part of the scraper: a short description of a
 *   provider to look up, the result of looking one up (an "extraction"), and the contract every data source
 *   (the AI website reader, the RCS business register) must follow. It contains no running code.
 * WHERE IT RUNS: nowhere on its own — types exist only while TypeScript checks the code and vanish when it
 *   runs (on Node.js, in GitHub Actions or on a laptop).
 * FRAMEWORK NOTES: none; this is plain TypeScript.
 * TYPESCRIPT YOU WILL SEE HERE: type aliases (`type X = { … }`), union with null (`string | null` = "text or
 *   nothing"), `Record<K, V>` (an object with keys K and values V), `unknown`, `interface`, method signatures,
 *   `Promise<…>`.
 */

// `import type { a } from "b"` imports only TypeScript types (nothing at run time).
// `@fundhub/…` = our shared packages. ExtractedField = one scraped value with its confidence and source URL;
// IngestSource = the allowed source names ("ai_web" | "rcs").
import type { ExtractedField, IngestSource } from "@fundhub/db/schema";

/**
 * Kind: type alias (exported).
 * The few provider facts the scraper needs: its database id, URL slug, name, website (may be missing,
 * hence `string | null`), Luxembourg RCS company number (may be missing), headquarters, and year founded.
 */
export type ProviderRef = {
  id: number;
  slug: string;
  name: string;
  website: string | null;
  rcsNumber: string | null;
  headquarters: string;
  foundedYear: number | null;
};

/**
 * Kind: type alias (exported).
 * Keys are provider column names, so the admin review maps them 1:1.
 * - provider: which provider this is about.
 * - sourceUrl: the page the facts came from (null if not from a web page).
 * - fields: e.g. { phone: { value: "+352 …", confidence: 0.9 } } — one entry per discovered fact.
 * - raw: the unprocessed data kept for reference; `Record<string, unknown>` = any keys, values of any type.
 */
export type Extraction = {
  provider: ProviderRef;
  sourceUrl: string | null;
  fields: Record<string, ExtractedField>;
  raw: Record<string, unknown>;
};

/**
 * Kind: interface (exported) — a contract that classes promise to fulfil (`class X implements Source`).
 * Every data source has a `name` and a `fetch` method that looks up one provider.
 */
export interface Source {
  name: IngestSource;
  /**
   * Null when the source has nothing for this provider.
   * @param provider  type `ProviderRef` — who to look up.
   * @returns         `Promise<Extraction | null>`: the findings, arriving later, or null.
   */
  fetch(provider: ProviderRef): Promise<Extraction | null>;
}
