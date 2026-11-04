/**
 * FILE: services/engine/src/core/types.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: The contracts every source adapter follows, and the shape of a parsed record. A new source
 *   (RESA, LuxSE, a paid LBR feed…) = one new folder in src/sources implementing `SourceAdapter`; the
 *   ingest pipeline (core/ingest.ts) then handles storage, change detection, matching and classification.
 * WHERE IT RUNS: types only — nothing at run time.
 * TYPESCRIPT YOU WILL SEE HERE: `interface`, optional members `?`, generics, union types.
 */

import type { Address, EngineSource, IdScheme, Logo, RelationKind } from "@fundhub/engine-db/schema";

/** Kind: type alias. Raw bytes fetched from a source, before parsing. */
export type RawCapture = {
  source: EngineSource;
  externalId: string;
  url: string;
  httpStatus: number | null;
  contentType: string;
  body: Buffer;
  /** File extension for storage ("json", "html", "txt"). */
  ext: string;
};

/**
 * Kind: type alias. Canonical attributes a source can state about an entity. Values are plain JSON.
 * The golden record (core/golden.ts) picks, per attribute, the value from the most trusted source.
 */
export type Facts = {
  name?: string;
  legalForm?: string | null;
  status?: "active" | "in_liquidation" | "struck_off" | "unknown";
  address?: Address | null;
  registrationDate?: string | null;
  lei?: string | null;
  rcsNumber?: string | null;
  website?: string | null;
  /** ISO time when the source confirmed the website belongs to the entity (legal notice shows its RCS no.). */
  websiteVerifiedAt?: string | null;
  /** Countries where the entity operates, ISO 3166-1 alpha-2 (use normalizeCountries()). */
  operatingCountries?: string[];
  /** Logo already stored in object storage (see core/media.ts storeLogo()). */
  logo?: Logo | null;
  /** Anything source-specific (CSSF type, GLEIF legal-form code, last filing date…). */
  [key: string]: unknown;
};

/** Kind: type alias. One CSSF detail line (see the cssf_details table). */
export type CssfDetailRow = {
  detailType: string;
  kind: string;
  code: string;
  label: string | null;
  lei: string | null;
  startDate: string | null;
  endDate: string | null;
};

/** Kind: type alias. One RCS filing (see the rcs_filings table). */
export type RcsFilingRow = {
  filingNumber: string;
  filingDate: string | null;
  type: string;
  details: string[];
  corrects: string | null;
  correctedBy: string | null;
  hasDocuments: boolean;
};

/**
 * Kind: type alias. One relation stated by a source, from the point of view of the record's entity:
 * "this entity is <kind> of <objectName>" (e.g. kind "client" = objectName is one of its clients).
 */
export type RelationRow = { kind: RelationKind; objectName: string; evidenceUrl: string | null; confidence: number };

/** Kind: type alias. What a parser returns for one source record. */
export type ParsedRecord = {
  source: EngineSource;
  externalId: string;
  /** "found" normally; "not_found" when the source says the id does not exist. */
  state: "found" | "not_found";
  /** Grouping at the source (CSSF entity type, RCS prefix, GLEIF country…). */
  scope?: string | null;
  facts: Facts;
  identifiers: { scheme: IdScheme; value: string }[];
  names: { name: string; kind: "legal" | "former" | "trade"; validFrom: string | null }[];
  cssfDetails?: CssfDetailRow[];
  rcsFilings?: RcsFilingRow[];
  /** Clients and other relations (web agent, filings…). A full list each time: missing ones are ended. */
  relations?: RelationRow[];
};

/** Kind: type alias. An id found during discovery, possibly with its raw content already in hand. */
export type Discovered = { externalId: string; scope?: string | null; raw?: RawCapture };

/** Kind: interface. A data source. */
export interface SourceAdapter {
  source: EngineSource;
  /** Bump when the parser changes output, so old captures can be re-parsed. */
  parserVersion: number;
  /** Fetch one id; returns null if the source has nothing (not found). */
  fetch(externalId: string): Promise<RawCapture | null>;
  /** Pure: bytes → parsed record. Must not do I/O (so it can be tested on fixtures and re-run on history). */
  parse(raw: RawCapture): ParsedRecord;
}
