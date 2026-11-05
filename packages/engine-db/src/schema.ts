/**
 * FILE: packages/engine-db/src/schema.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: Describes every table of the Scraping Engine database. The design has four layers:
 *   1. RAW / PROVENANCE — `source_records` (one row per id at a source, e.g. CSSF entity 7013419 or RCS
 *      B145917) and `captures` (every fetch, immutable; the bytes themselves live in object storage).
 *   2. CORE — `entities` (one "golden record" per real legal entity, merged across sources), its identifiers,
 *      names, attribute-level `observations` (who said what, when), and register details (CSSF statuses,
 *      RCS filings, documents).
 *   3. CHANGE TRACKING — `change_events`: every difference the engine notices, for alerts and analytics.
 *   4. OPS — runs, cursors, census snapshots, RCS number space, session health, matching review.
 *   The website never reads raw rows: the promoter copies curated facts into the website database.
 * WHERE IT RUNS: on Node.js wherever the engine runs, and in drizzle-kit to generate migrations.
 * FRAMEWORK NOTES: same Drizzle conventions as packages/db/src/schema.ts — camelCase in TypeScript,
 *   snake_case in SQL; `(t) => [ ... ]` lists indexes. `$type<...>()` only tells TypeScript what a jsonb
 *   column holds. `.where(sql\`...\`)` on an index makes a "partial index" (only rows matching the condition).
 * TYPESCRIPT YOU WILL SEE HERE: `AnyPgColumn` (needed when a table points at itself), `typeof t.$inferSelect`.
 */

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  bigserial,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  CHANGE_KINDS,
  CLASSIFICATION_SOURCES,
  ENGINE_SOURCES,
  ENTITY_KINDS,
  ENTITY_STATUSES,
  ID_SCHEMES,
  MATCH_DECISIONS,
  MATCH_METHODS,
  RELATION_KINDS,
  RULE_KINDS,
  RUN_STATUSES,
  SESSION_STATES,
  SOURCE_RECORD_STATES,
  TEXT_STATUSES,
} from "./enums";

export * from "./enums";

/** `ts("x")` = timestamp with time zone. */
const ts = (name: string) => timestamp(name, { withTimezone: true });
/** `day("x")` = a calendar date, handled as "YYYY-MM-DD" text in TypeScript (no time-zone surprises). */
const day = (name: string) => date(name, { mode: "string" });
/** Big auto-numbered id, returned as a JS number (safe up to 9 quadrillion rows). */
const bigId = () => bigserial("id", { mode: "number" }).primaryKey();
/** A bigint foreign-key column, as a JS number. */
const bigRef = (name: string) => bigint(name, { mode: "number" });

// ============================================================ core: taxonomy

/**
 * Kind: table "activity_categories". The activity tree: level 1 = categories (the 8 website categories plus
 * "funds", "financial-institutions", "corporate"), level 2 = subcategories (`parent_id` points to level 1).
 */
export const activityCategories = pgTable(
  "activity_categories",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    label: text("label").notNull(),
    parentId: integer("parent_id").references((): AnyPgColumn => activityCategories.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    /** True when entities in this category are service providers to funds (the directory's scope). */
    serviceProvider: boolean("service_provider").notNull().default(false),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("activity_categories_parent_idx").on(t.parentId)],
);

// ============================================================ core: entities

/**
 * Kind: table "entities". The golden record: one row per real legal entity, whatever source found it.
 * Fields here are DERIVED from `observations` by source precedence (see services/engine/src/core/golden.ts),
 * except the classification, which comes from rules / AI / a person (`classification_source`).
 */
export const entities = pgTable(
  "entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalName: text("canonical_name").notNull(),
    /** Lower-case, accents and legal-form words stripped: used for matching (see core/normalize.ts). */
    normalizedName: text("normalized_name").notNull(),
    legalForm: text("legal_form"),
    status: text("status", { enum: ENTITY_STATUSES }).notNull().default("unknown"),
    rcsNumber: text("rcs_number").unique(),
    lei: text("lei").unique(),
    /** { street, postcode, city, country, raw } */
    registeredAddress: jsonb("registered_address").$type<Address>(),
    registrationDate: day("registration_date"),
    website: text("website"),
    /** Set when the website was confirmed to belong to this entity (e.g. its legal notice shows our RCS number). */
    websiteVerifiedAt: ts("website_verified_at"),
    /** Countries where the entity operates (offices / service delivery), ISO 3166-1 alpha-2, e.g. ["LU","IE"]. */
    operatingCountries: jsonb("operating_countries").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** The logo, stored in object storage (see services/engine/src/core/media.ts). */
    logo: jsonb("logo").$type<Logo>(),
    isServiceProvider: boolean("is_service_provider").notNull().default(false),
    entityKind: text("entity_kind", { enum: ENTITY_KINDS }).notNull().default("other"),
    activityCategoryId: integer("activity_category_id").references(() => activityCategories.id, { onDelete: "set null" }),
    activitySubcategoryId: integer("activity_subcategory_id").references(() => activityCategories.id, { onDelete: "set null" }),
    classificationSource: text("classification_source", { enum: CLASSIFICATION_SOURCES }),
    classifiedAt: ts("classified_at"),
    tier: integer("tier").notNull().default(0),
    /** id of the matching row in the WEBSITE database's `providers` table, once promoted. */
    websiteProviderId: integer("website_provider_id"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    lastChangedAt: ts("last_changed_at").notNull().defaultNow(),
  },
  (t) => [
    index("entities_normalized_name_idx").on(t.normalizedName),
    index("entities_kind_idx").on(t.entityKind),
    index("entities_sp_idx").on(t.isServiceProvider),
    index("entities_tier_idx").on(t.tier),
  ],
);

/** Kind: type alias. A postal address as stored in jsonb. */
export type Address = { street?: string | null; postcode?: string | null; city?: string | null; country?: string | null; raw: string };

/** Kind: type alias. A stored logo: where the bytes are, where they came from, and their type. */
export type Logo = { blobKey: string; sourceUrl: string; mime: string; sha256: string; bytes: number };

/**
 * Kind: table "entity_identifiers". Every id an entity is known by (RCS B145917, LEI, CSSF P00000348…).
 * Unique per (scheme, value): one RCS number can belong to one entity only — this is what makes merging safe.
 */
export const entityIdentifiers = pgTable(
  "entity_identifiers",
  {
    id: serial("id").primaryKey(),
    entityId: uuid("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
    scheme: text("scheme", { enum: ID_SCHEMES }).notNull(),
    value: text("value").notNull(),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("entity_identifiers_scheme_value_uq").on(t.scheme, t.value), index("entity_identifiers_entity_idx").on(t.entityId)],
);

/** Kind: table "entity_names". Name history from every source (legal, former, trade names). */
export const entityNames = pgTable(
  "entity_names",
  {
    id: serial("id").primaryKey(),
    entityId: uuid("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["legal", "former", "trade"] }).notNull().default("legal"),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    validFrom: day("valid_from"),
    validTo: day("valid_to"),
  },
  (t) => [uniqueIndex("entity_names_uq").on(t.entityId, t.source, t.name), index("entity_names_entity_idx").on(t.entityId)],
);

/**
 * Kind: table "entity_relations". Who works for whom: subject (usually a service provider) → object (its
 * client), with the role. Example: Arendt — administrator → "Silverline SICAV". `object_name` is the name as
 * the source wrote it; `object_entity_id` links the client's own golden record once it can be matched.
 * History is kept: a relation that disappears from its source gets `valid_to`, it is never deleted.
 * The clients of a provider = rows where subject_entity_id = provider and valid_to is null.
 */
export const entityRelations = pgTable(
  "entity_relations",
  {
    id: bigId(),
    subjectEntityId: uuid("subject_entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: RELATION_KINDS }).notNull(),
    objectName: text("object_name").notNull(),
    objectNormalizedName: text("object_normalized_name").notNull(),
    objectEntityId: uuid("object_entity_id").references(() => entities.id, { onDelete: "set null" }),
    /** Optional: the service concerned (a level-2 activity category). */
    subcategoryId: integer("subcategory_id").references(() => activityCategories.id, { onDelete: "set null" }),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    sourceRecordId: bigRef("source_record_id").references(() => sourceRecords.id, { onDelete: "set null" }),
    /** The page or document that states the relation. */
    evidenceUrl: text("evidence_url"),
    confidence: real("confidence").notNull().default(1),
    validFrom: ts("valid_from").notNull().defaultNow(),
    validTo: ts("valid_to"),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("entity_relations_uq").on(t.subjectEntityId, t.kind, t.objectNormalizedName, t.source),
    index("entity_relations_object_idx").on(t.objectEntityId),
    index("entity_relations_object_name_idx").on(t.objectNormalizedName),
  ],
);

// ============================================================ raw / provenance

/**
 * Kind: table "source_records". One row per (source, external id) — e.g. ("cssf", "7013419"),
 * ("rcs", "B145917"), ("gleif", "222100IVSOG87C1WWJ84"). Remembers whether the id exists, the hash of the
 * last parsed content (to detect changes cheaply) and which entity it was resolved to.
 * `next_fetch_at` drives the rolling refresh: workers pick the oldest due rows.
 */
export const sourceRecords = pgTable(
  "source_records",
  {
    id: bigId(),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    externalId: text("external_id").notNull(),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    state: text("state", { enum: SOURCE_RECORD_STATES }).notNull().default("found"),
    /** Free-form grouping at the source, e.g. the CSSF entity type "SPP" or the RCS prefix "B". */
    scope: text("scope"),
    contentHash: text("content_hash"),
    latestCaptureId: bigRef("latest_capture_id"),
    /** The latest parsed content, kept here too for fast diffs and reads. */
    parsed: jsonb("parsed").$type<Record<string, unknown>>(),
    parserVersion: integer("parser_version"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    lastChangedAt: ts("last_changed_at").notNull().defaultNow(),
    nextFetchAt: ts("next_fetch_at"),
  },
  (t) => [
    uniqueIndex("source_records_source_ext_uq").on(t.source, t.externalId),
    index("source_records_entity_idx").on(t.entityId),
    index("source_records_due_idx").on(t.source, t.nextFetchAt),
    index("source_records_scope_idx").on(t.source, t.scope),
  ],
);

/**
 * Kind: table "captures". Every fetch, never updated afterwards. The raw bytes are in object storage under
 * `blob_key` (content-addressed by sha256, so identical pages are stored once). `parsed` + `parser_version`
 * allow re-parsing old captures after a parser fix without re-scraping.
 */
export const captures = pgTable(
  "captures",
  {
    id: bigId(),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    runId: integer("run_id").references(() => crawlRuns.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    httpStatus: integer("http_status"),
    contentType: text("content_type"),
    bytes: integer("bytes"),
    /** sha256 of the raw bytes. */
    rawHash: text("raw_hash").notNull(),
    blobKey: text("blob_key").notNull(),
    /** sha256 of the canonical parsed JSON (stable across cosmetic page changes). */
    contentHash: text("content_hash"),
    parsed: jsonb("parsed").$type<Record<string, unknown>>(),
    parserVersion: integer("parser_version"),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
  },
  (t) => [index("captures_record_idx").on(t.sourceRecordId, t.fetchedAt)],
);

/**
 * Kind: table "observations". Attribute-level facts with provenance and history ("SCD type 2"):
 * the open row (valid_to IS NULL) is the source's current claim; a change closes it and opens a new one.
 * This answers "what did source X say about attribute Y on date Z" and feeds the golden record.
 */
export const observations = pgTable(
  "observations",
  {
    id: bigId(),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "cascade" }),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    attribute: text("attribute").notNull(),
    value: jsonb("value").$type<unknown>(),
    confidence: real("confidence").notNull().default(1),
    captureId: bigRef("capture_id").references(() => captures.id, { onDelete: "set null" }),
    validFrom: ts("valid_from").notNull().defaultNow(),
    validTo: ts("valid_to"),
  },
  (t) => [
    index("observations_open_idx").on(t.sourceRecordId, t.attribute).where(sql`valid_to is null`),
    index("observations_entity_idx").on(t.entityId, t.attribute),
  ],
);

// ============================================================ register details

/**
 * Kind: table "cssf_details". The detail lines of a CSSF register entry: authorised statuses
 * (ACT_…), other statuses (OST_…), investment services (SER_/ANC_/SERVPAY_…) and fund compartments
 * (COMPARTMENT_NAME, with their own LEI). `kind` is the group shown on the CSSF page.
 */
export const cssfDetails = pgTable(
  "cssf_details",
  {
    id: bigId(),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    detailType: text("detail_type").notNull(),
    /** "authorised" | "other" | "service" | "ancillary" | "payment" | "crypto" | "compartment" | "other_detail" */
    kind: text("kind").notNull(),
    code: text("code").notNull(),
    label: text("label"),
    lei: text("lei"),
    startDate: day("start_date"),
    endDate: day("end_date"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("cssf_details_uq").on(t.sourceRecordId, t.detailType, t.code),
    index("cssf_details_code_idx").on(t.code),
  ],
);

/**
 * Kind: table "documents". Downloaded files (RCS filing PDFs…), keyed by sha256 so a file shared by several
 * filings is stored once. Text extraction writes the plain text to object storage too.
 */
export const documents = pgTable("documents", {
  sha256: text("sha256").primaryKey(),
  blobKey: text("blob_key").notNull(),
  mime: text("mime").notNull(),
  bytes: integer("bytes").notNull(),
  pages: integer("pages"),
  /** The filing this document was opened from (when known), so it can be linked once the filing is captured. */
  filingNumber: text("filing_number"),
  textStatus: text("text_status", { enum: TEXT_STATUSES }).notNull().default("pending"),
  textBlobKey: text("text_blob_key"),
  downloadedAt: ts("downloaded_at").notNull().defaultNow(),
});

/**
 * Kind: table "rcs_filings". The list of filings of an RCS entity ("dépôts"), e.g. L260377560 on
 * 21/09/2026 "Authorized signature list". `corrects` / `corrected_by` link correction filings.
 * A filing number never changes, so a NEW number = a new filing = a `new_filing` change event.
 */
export const rcsFilings = pgTable(
  "rcs_filings",
  {
    filingNumber: text("filing_number").primaryKey(),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    filingDate: day("filing_date"),
    type: text("type").notNull(),
    details: jsonb("details").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    corrects: text("corrects"),
    correctedBy: text("corrected_by"),
    hasDocuments: boolean("has_documents").notNull().default(true),
    documentSha256: text("document_sha256").references(() => documents.sha256, { onDelete: "set null" }),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
  },
  (t) => [index("rcs_filings_record_idx").on(t.sourceRecordId, t.filingDate), index("rcs_filings_doc_todo_idx").on(t.documentSha256)],
);

// ============================================================ classification & matching

/**
 * Kind: table "classification_rules". Turns register facts into a classification. Example:
 * kind "cssf_activity", match "ACT_SPP_DOM" → service provider, category governance-domiciliation,
 * subcategory "domiciliation…". The highest `priority` matching rule wins for each output field.
 */
export const classificationRules = pgTable(
  "classification_rules",
  {
    id: serial("id").primaryKey(),
    kind: text("kind", { enum: RULE_KINDS }).notNull(),
    match: text("match").notNull(),
    isServiceProvider: boolean("is_service_provider"),
    entityKind: text("entity_kind", { enum: ENTITY_KINDS }),
    categoryId: integer("category_id").references(() => activityCategories.id, { onDelete: "set null" }),
    subcategoryId: integer("subcategory_id").references(() => activityCategories.id, { onDelete: "set null" }),
    tier: integer("tier"),
    priority: integer("priority").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    note: text("note"),
  },
  (t) => [uniqueIndex("classification_rules_uq").on(t.kind, t.match)],
);

/**
 * Kind: table "match_candidates". Possible links between a source record and an entity that were not
 * certain enough to apply automatically (or were, recorded as "auto" for audit).
 */
export const matchCandidates = pgTable(
  "match_candidates",
  {
    id: bigId(),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id").notNull().references(() => entities.id, { onDelete: "cascade" }),
    method: text("method", { enum: MATCH_METHODS }).notNull(),
    score: real("score").notNull(),
    decision: text("decision", { enum: MATCH_DECISIONS }).notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("match_candidates_uq").on(t.sourceRecordId, t.entityId), index("match_candidates_pending_idx").on(t.decision)],
);

// ============================================================ change tracking

/**
 * Kind: table "change_events". Every change the engine notices. The feed for alerts, the website's
 * "recently changed" sections and Data Intelligence. `entity_id` may be null for records not yet resolved.
 */
export const changeEvents = pgTable(
  "change_events",
  {
    id: bigId(),
    entityId: uuid("entity_id").references(() => entities.id, { onDelete: "set null" }),
    sourceRecordId: bigRef("source_record_id").references(() => sourceRecords.id, { onDelete: "set null" }),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    kind: text("kind", { enum: CHANGE_KINDS }).notNull(),
    attribute: text("attribute"),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    /** Who caused it: "staff:<email>" for console edits, "engine:<job>" (or null) for the scrapers. */
    actor: text("actor"),
    detectedAt: ts("detected_at").notNull().defaultNow(),
  },
  (t) => [
    index("change_events_entity_idx").on(t.entityId, t.detectedAt),
    index("change_events_kind_idx").on(t.kind, t.detectedAt),
    index("change_events_detected_idx").on(t.detectedAt),
  ],
);

/**
 * Kind: table "row_history". A database-level safety net: Postgres triggers (migration 0002) copy the old and
 * new version of every changed row of entities, entity_relations, classification_rules, activity_categories
 * and rcs_number_space here — whoever made the change, including plain SQL. `actor` comes from
 * `set_config('app.actor', …)` (see core/entity.ts withActor()); empty means "not tagged".
 */
export const rowHistory = pgTable(
  "row_history",
  {
    id: bigId(),
    tableName: text("table_name").notNull(),
    rowId: text("row_id").notNull(),
    op: text("op", { enum: ["INSERT", "UPDATE", "DELETE"] }).notNull(),
    oldRow: jsonb("old_row").$type<Record<string, unknown>>(),
    newRow: jsonb("new_row").$type<Record<string, unknown>>(),
    actor: text("actor"),
    changedAt: ts("changed_at").notNull().defaultNow(),
  },
  (t) => [index("row_history_row_idx").on(t.tableName, t.rowId, t.changedAt), index("row_history_changed_idx").on(t.changedAt)],
);

// ============================================================ ops

/** Kind: table "crawl_runs". One row per job execution: which job, how it went, counters. */
export const crawlRuns = pgTable(
  "crawl_runs",
  {
    id: serial("id").primaryKey(),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    job: text("job").notNull(),
    status: text("status", { enum: RUN_STATUSES }).notNull().default("running"),
    trigger: text("trigger").notNull().default("manual"),
    params: jsonb("params").$type<Record<string, unknown>>(),
    stats: jsonb("stats").$type<Record<string, number>>(),
    error: text("error"),
    startedAt: ts("started_at").notNull().defaultNow(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("crawl_runs_started_idx").on(t.startedAt)],
);

/** Kind: table "source_cursors". Small key/value state per source, e.g. GLEIF "last delta at". */
export const sourceCursors = pgTable(
  "source_cursors",
  {
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.source, t.key] })],
);

/**
 * Kind: table "census_snapshots". "How many entities exist" per source and scope, per day:
 * `expected_total` = what the source itself reports (CSSF totals, GLEIF total) when it does,
 * `seen` = what we hold, `active`, `new` and `gone` since the previous snapshot.
 */
export const censusSnapshots = pgTable(
  "census_snapshots",
  {
    id: serial("id").primaryKey(),
    takenOn: day("taken_on").notNull(),
    /** An engine source, or "registry" for counts over golden entities (by kind, service providers…). */
    source: text("source").notNull(),
    scope: text("scope").notNull(),
    expectedTotal: integer("expected_total"),
    seen: integer("seen").notNull(),
    active: integer("active"),
    added: integer("added"),
    gone: integer("gone"),
  },
  (t) => [uniqueIndex("census_snapshots_uq").on(t.takenOn, t.source, t.scope)],
);

/**
 * Kind: table "rcs_number_space". RCS numbers are sequential per prefix letter (B = commercial companies…).
 * `max_known` = highest number seen to exist (the "frontier"); `swept_to` = backfill progress.
 */
export const rcsNumberSpace = pgTable("rcs_number_space", {
  prefix: text("prefix").primaryKey(),
  label: text("label").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  maxKnown: integer("max_known").notNull().default(0),
  sweptTo: integer("swept_to").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/**
 * Kind: table "capture_rounds". A capture ROUND ("loop"): a planned pass over a list of RCS companies that a
 * person works through in the browser (FundHub LBR Capture extension). "initial" = companies never captured;
 * "update" = companies captured before, to pick up changes and new filings (unchanged pages cost nothing:
 * content hash). At most one round is active. Closed rounds are the register of past passes.
 */
export const captureRounds = pgTable(
  "capture_rounds",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["initial", "update"] }).notNull(),
    /** { filter: "all" | "sp" | "am" | "text", text?, skipCapturedWithinDays? } */
    scope: jsonb("scope").$type<RoundScope>().notNull(),
    status: text("status", { enum: ["active", "closed"] }).notNull().default("active"),
    createdBy: text("created_by"),
    notes: text("notes"),
    startedAt: ts("started_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
  },
  (t) => [uniqueIndex("capture_rounds_one_active_uq").on(t.status).where(sql`status = 'active'`)],
);

/** Kind: type alias. Which companies a round covers. */
export type RoundScope = { filter: "all" | "sp" | "am" | "text"; text?: string; skipCapturedWithinDays?: number };

/** Kind: constant. States of one company within a round. */
export const ROUND_ITEM_STATUSES = ["pending", "captured", "changed", "unchanged", "not_found", "skipped", "failed"] as const;

/**
 * Kind: table "capture_round_items". One company of a round and what happened when it was visited: new page
 * (captured), changed, unchanged, not found, skipped… with the number of new filings and new documents saved.
 */
export const captureRoundItems = pgTable(
  "capture_round_items",
  {
    roundId: integer("round_id").notNull().references(() => captureRounds.id, { onDelete: "cascade" }),
    rcs: text("rcs").notNull(),
    position: integer("position").notNull(),
    status: text("status", { enum: ROUND_ITEM_STATUSES }).notNull().default("pending"),
    visitedAt: ts("visited_at"),
    filingsBefore: integer("filings_before"),
    filingsAfter: integer("filings_after"),
    newFilings: integer("new_filings").notNull().default(0),
    newDocuments: integer("new_documents").notNull().default(0),
    error: text("error"),
  },
  (t) => [primaryKey({ columns: [t.roundId, t.rcs] }), index("capture_round_items_next_idx").on(t.roundId, t.status, t.position)],
);

/**
 * Kind: table "engine_settings". Small key/value settings changed from the admin console, e.g.
 * "disabled_schedules" = ["rcs_sweep"]. The scheduler reads them at start (and the console applies them live).
 */
export const engineSettings = pgTable("engine_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>(),
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Kind: table "session_health". State of logged-in sessions (RCS / LuxTrust). Workers pause when not "ok". */
export const sessionHealth = pgTable("session_health", {
  source: text("source", { enum: ENGINE_SOURCES }).primaryKey(),
  state: text("state", { enum: SESSION_STATES }).notNull().default("unknown"),
  message: text("message"),
  checkedAt: ts("checked_at").notNull().defaultNow(),
});

// ============================================================ inferred types

export type Entity = typeof entities.$inferSelect;
export type SourceRecord = typeof sourceRecords.$inferSelect;
export type Capture = typeof captures.$inferSelect;
export type Observation = typeof observations.$inferSelect;
export type ChangeEvent = typeof changeEvents.$inferSelect;
export type ClassificationRule = typeof classificationRules.$inferSelect;
export type ActivityCategory = typeof activityCategories.$inferSelect;
export type RcsFiling = typeof rcsFilings.$inferSelect;
export type EntityRelation = typeof entityRelations.$inferSelect;
export type RowHistory = typeof rowHistory.$inferSelect;
export type CaptureRound = typeof captureRounds.$inferSelect;
export type CaptureRoundItem = typeof captureRoundItems.$inferSelect;
