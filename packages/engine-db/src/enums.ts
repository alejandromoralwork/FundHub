/**
 * FILE: packages/engine-db/src/enums.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: The fixed lists of allowed words used by the engine database (source names, entity kinds,
 *   change-event kinds…). Keeping them in one place means the schema, the workers and later the admin
 *   console all agree on the same spelling.
 * WHERE IT RUNS: anywhere — it is plain data.
 * TYPESCRIPT YOU WILL SEE HERE: `as const` (keep the exact words as types), indexed access types
 *   `(typeof X)[number]` (= "any one item of the list X").
 */

/** Kind: constant. Every data source the engine knows. Adding a source = add its name here + an adapter. */
export const ENGINE_SOURCES = ["cssf", "gleif", "rcs", "web"] as const;
/** "cssf" | "gleif" | "rcs" | "web" */
export type EngineSource = (typeof ENGINE_SOURCES)[number];

/** Kind: constant. What we last learned about an id at its source. */
export const SOURCE_RECORD_STATES = ["found", "not_found", "gone"] as const;
export type SourceRecordState = (typeof SOURCE_RECORD_STATES)[number];

/** Kind: constant. Life-cycle status of a legal entity (golden record). */
export const ENTITY_STATUSES = ["active", "in_liquidation", "struck_off", "unknown"] as const;
export type EntityStatus = (typeof ENTITY_STATUSES)[number];

/** Kind: constant. Broad kind of entity; finer detail lives in activity category / subcategory. */
export const ENTITY_KINDS = ["service_provider", "asset_manager", "fund", "bank", "financial_institution", "corporate", "other"] as const;
export type EntityKind = (typeof ENTITY_KINDS)[number];

/**
 * Kind: constant. How deep the engine goes for an entity:
 * 0 = register metadata only · 1 = + filing PDFs · 2 = + website agent and frequent refresh.
 */
export const TIERS = [0, 1, 2] as const;
export type Tier = (typeof TIERS)[number];

/** Kind: constant. Who decided an entity's classification. "manual" is never overwritten by rules. */
export const CLASSIFICATION_SOURCES = ["rule", "ai", "manual"] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

/** Kind: constant. Identifier schemes stored in entity_identifiers. */
export const ID_SCHEMES = ["rcs", "lei", "cssf_code", "cssf_id", "vat", "matricule"] as const;
export type IdScheme = (typeof ID_SCHEMES)[number];

/** Kind: constant. What a change event is about. */
export const CHANGE_KINDS = [
  "new_entity",
  "new_record",
  "record_gone",
  "attribute_changed",
  "name_change",
  "status_change",
  "address_change",
  "new_filing",
  "authorisation_added",
  "authorisation_ended",
  "entities_merged",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Kind: constant. How a match between a source record and an entity was found. */
export const MATCH_METHODS = ["rcs_exact", "lei_exact", "cssf_exact", "gleif_bridge", "name_postcode", "name_only", "manual"] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

/** Kind: constant. Decision on a match candidate. "pending" waits for a person. */
export const MATCH_DECISIONS = ["auto", "pending", "accepted", "rejected"] as const;
export type MatchDecision = (typeof MATCH_DECISIONS)[number];

/** Kind: constant. States of one engine run. */
export const RUN_STATUSES = ["running", "succeeded", "failed", "paused"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Kind: constant. Health of a logged-in source session (RCS through LuxTrust). */
export const SESSION_STATES = ["ok", "logged_out", "blocked", "unknown"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** Kind: constant. Where a classification rule looks. */
export const RULE_KINDS = ["cssf_type", "cssf_activity", "rcs_legal_form", "keyword"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/** Kind: constant. Text-extraction state of a downloaded document. */
export const TEXT_STATUSES = ["pending", "done", "failed", "needs_ocr"] as const;
export type TextStatus = (typeof TEXT_STATUSES)[number];
