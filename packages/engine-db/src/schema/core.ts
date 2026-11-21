/**
 * FILE: packages/engine-db/src/schema/core.ts
 * PART: shared package (packages/engine-db) — layer "core" (the golden records)
 * WHAT IT DOES: One row per real company, whatever source found it, plus everything known about it:
 *   identifiers, names, relations to other companies, people and their positions, web and social presence,
 *   news mentions, review scores, which source won each golden field (lineage), and the change feed.
 *   Golden fields are DERIVED by the consolidate stage from clean.claims using ops.attribute_precedence —
 *   never typed in directly (a staff edit is a "manual" claim, so it has history and can be undone).
 * WHERE IT RUNS: Node.js (engine workers, admin console), drizzle-kit.
 * TYPESCRIPT YOU WILL SEE HERE: `AnyPgColumn` (a table pointing at itself), `$type<...>()` for jsonb.
 */

import { sql } from "drizzle-orm";
import { type AnyPgColumn, boolean, index, integer, jsonb, primaryKey, real, serial, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import {
  CHANGE_KINDS,
  CLASSIFICATION_SOURCES,
  COMPANY_KINDS,
  COMPANY_STATUSES,
  ENGINE_SOURCES,
  ID_SCHEMES,
  MATCH_DECISIONS,
  PLATFORMS,
  POSITION_ROLES,
  RELATION_KINDS,
  RULE_KINDS,
} from "../enums";
import { claims, articles } from "./clean";
import { type Address, type Logo, bigId, bigRef, core, day, ts } from "./shared";
import { sourceRecords } from "./staging";

// ------------------------------------------------------------------ taxonomy

/**
 * Kind: table "core.activity_categories". Level 1 = categories (the 8 website categories plus "funds",
 * "financial-institutions", "corporate"), level 2 = subcategories (`parent_id` points to level 1).
 */
export const activityCategories = core.table(
  "activity_categories",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    label: text("label").notNull(),
    parentId: integer("parent_id").references((): AnyPgColumn => activityCategories.id, { onDelete: "cascade" }),
    level: integer("level").notNull(),
    /** True when companies in this category are service providers to funds (the directory's scope). */
    serviceProvider: boolean("service_provider").notNull().default(false),
    sort: integer("sort").notNull().default(0),
  },
  (t) => [index("activity_categories_parent_idx").on(t.parentId)],
);

/**
 * Kind: table "core.classification_rules". Turns register facts into a classification. Example: kind
 * "cssf_activity", match "ACT_SPP_DOM" → service provider, governance-domiciliation. Highest priority wins.
 */
export const classificationRules = core.table(
  "classification_rules",
  {
    id: serial("id").primaryKey(),
    kind: text("kind", { enum: RULE_KINDS }).notNull(),
    match: text("match").notNull(),
    isServiceProvider: boolean("is_service_provider"),
    companyKind: text("company_kind", { enum: COMPANY_KINDS }),
    categoryId: integer("category_id").references(() => activityCategories.id, { onDelete: "set null" }),
    subcategoryId: integer("subcategory_id").references(() => activityCategories.id, { onDelete: "set null" }),
    tier: integer("tier"),
    priority: integer("priority").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    note: text("note"),
  },
  (t) => [uniqueIndex("classification_rules_uq").on(t.kind, t.match)],
);

// ------------------------------------------------------------------ companies

/** Kind: table "core.companies". The golden record: one row per real company. */
export const companies = core.table(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canonicalName: text("canonical_name").notNull(),
    /** Lower-case, accents and legal-form words stripped: used for matching (see core/normalize.ts). */
    normalizedName: text("normalized_name").notNull(),
    legalForm: text("legal_form"),
    status: text("status", { enum: COMPANY_STATUSES }).notNull().default("unknown"),
    rcsNumber: text("rcs_number").unique(),
    lei: text("lei").unique(),
    registeredAddress: jsonb("registered_address").$type<Address>(),
    registrationDate: day("registration_date"),
    website: text("website"),
    /** Set when the website was confirmed to belong to this company (its legal notice shows our RCS number). */
    websiteVerifiedAt: ts("website_verified_at"),
    description: text("description"),
    phone: text("phone"),
    /** A generic company address (info@…), never a person's. */
    email: text("email"),
    headcount: integer("headcount"),
    foundedYear: integer("founded_year"),
    /** Countries where the company operates, ISO 3166-1 alpha-2, e.g. ["LU","IE"]. */
    operatingCountries: jsonb("operating_countries").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    services: jsonb("services").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    logo: jsonb("logo").$type<Logo>(),
    isServiceProvider: boolean("is_service_provider").notNull().default(false),
    companyKind: text("company_kind", { enum: COMPANY_KINDS }).notNull().default("other"),
    activityCategoryId: integer("activity_category_id").references(() => activityCategories.id, { onDelete: "set null" }),
    activitySubcategoryId: integer("activity_subcategory_id").references(() => activityCategories.id, { onDelete: "set null" }),
    classificationSource: text("classification_source", { enum: CLASSIFICATION_SOURCES }),
    classifiedAt: ts("classified_at"),
    tier: integer("tier").notNull().default(0),
    /** id of the matching row in the WEBSITE database's `providers` table (FundHub account / listing). */
    websiteProviderId: integer("website_provider_id"),
    /** How many sources currently state something about this company (cross-check depth). */
    sourceCount: integer("source_count").notNull().default(0),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    lastChangedAt: ts("last_changed_at").notNull().defaultNow(),
  },
  (t) => [
    index("companies_normalized_name_idx").on(t.normalizedName),
    index("companies_kind_idx").on(t.companyKind),
    index("companies_sp_idx").on(t.isServiceProvider),
    index("companies_tier_idx").on(t.tier),
    index("companies_provider_idx").on(t.websiteProviderId),
  ],
);

/** Kind: table "core.company_identifiers". Every id a company is known by. Unique per (scheme, value). */
export const companyIdentifiers = core.table(
  "company_identifiers",
  {
    id: serial("id").primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    scheme: text("scheme", { enum: ID_SCHEMES }).notNull(),
    value: text("value").notNull(),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("company_identifiers_scheme_value_uq").on(t.scheme, t.value), index("company_identifiers_company_idx").on(t.companyId)],
);

/** Kind: table "core.company_names". Name history from every source (legal, former, trade names). */
export const companyNames = core.table(
  "company_names",
  {
    id: serial("id").primaryKey(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["legal", "former", "trade"] }).notNull().default("legal"),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    validFrom: day("valid_from"),
    validTo: day("valid_to"),
  },
  (t) => [uniqueIndex("company_names_uq").on(t.companyId, t.source, t.name), index("company_names_company_idx").on(t.companyId)],
);

/**
 * Kind: table "core.company_relations". subject (usually a service provider) → object (a client, a fund…),
 * with the role. `object_name` = as the source wrote it; `object_company_id` once it can be matched.
 * History is kept: a relation that disappears from its source gets `valid_to`, it is never deleted.
 */
export const companyRelations = core.table(
  "company_relations",
  {
    id: bigId(),
    subjectCompanyId: uuid("subject_company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: RELATION_KINDS }).notNull(),
    objectName: text("object_name").notNull(),
    objectNormalizedName: text("object_normalized_name").notNull(),
    objectCompanyId: uuid("object_company_id").references(() => companies.id, { onDelete: "set null" }),
    /** Optional: the service concerned (a level-2 activity category). */
    subcategoryId: integer("subcategory_id").references(() => activityCategories.id, { onDelete: "set null" }),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    sourceRecordId: bigRef("source_record_id").references(() => sourceRecords.id, { onDelete: "set null" }),
    evidenceUrl: text("evidence_url"),
    confidence: real("confidence").notNull().default(1),
    validFrom: ts("valid_from").notNull().defaultNow(),
    validTo: ts("valid_to"),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("company_relations_uq").on(t.subjectCompanyId, t.kind, t.objectNormalizedName, t.source),
    index("company_relations_object_idx").on(t.objectCompanyId),
    index("company_relations_object_name_idx").on(t.objectNormalizedName),
  ],
);

// ------------------------------------------------------------------ people

/**
 * Kind: table "core.people". A person seen working at a company (team pages, filings, LinkedIn in phase 2).
 * Data minimization: name and public profile link only — no photos, no private contact details.
 * GDPR erasure requests delete the row (positions cascade).
 */
export const people = core.table(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fullName: text("full_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    profileUrl: text("profile_url").unique(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [index("people_normalized_name_idx").on(t.normalizedName)],
);

/** Kind: table "core.positions". Person × company × role, per source, with history (valid_to when it disappears). */
export const positions = core.table(
  "positions",
  {
    id: bigId(),
    personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    title: text("title").notNull().default(""),
    role: text("role", { enum: POSITION_ROLES }).notNull().default("other"),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    sourceRecordId: bigRef("source_record_id").references(() => sourceRecords.id, { onDelete: "set null" }),
    evidenceUrl: text("evidence_url"),
    validFrom: ts("valid_from").notNull().defaultNow(),
    validTo: ts("valid_to"),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("positions_uq").on(t.personId, t.companyId, t.title, t.source), index("positions_company_idx").on(t.companyId)],
);

// ------------------------------------------------------------------ web, social, news, reviews

/** Kind: table "core.web_presence". The company's website and social profiles, one row per platform URL. */
export const webPresence = core.table(
  "web_presence",
  {
    id: bigId(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    url: text("url").notNull(),
    handle: text("handle"),
    /** True when the profile links back to the company website or states its RCS number. */
    verified: boolean("verified").notNull().default(false),
    followers: integer("followers"),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("web_presence_uq").on(t.companyId, t.platform, t.url), index("web_presence_url_idx").on(t.url)],
);

/** Kind: table "core.news_mentions". An article (clean.articles) that mentions a company. Low confidence = pending review. */
export const newsMentions = core.table(
  "news_mentions",
  {
    id: bigId(),
    articleId: bigRef("article_id").notNull().references(() => articles.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    matchedText: text("matched_text").notNull(),
    confidence: real("confidence").notNull(),
    decision: text("decision", { enum: MATCH_DECISIONS }).notNull().default("auto"),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("news_mentions_uq").on(t.articleId, t.companyId), index("news_mentions_company_idx").on(t.companyId, t.createdAt), index("news_mentions_decision_idx").on(t.decision)],
);

/** Kind: table "core.review_summaries". Employer/customer rating per platform (Glassdoor… phase 2). */
export const reviewSummaries = core.table(
  "review_summaries",
  {
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    platform: text("platform", { enum: PLATFORMS }).notNull(),
    rating: real("rating"),
    reviewCount: integer("review_count"),
    url: text("url"),
    capturedAt: ts("captured_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.platform] })],
);

// ------------------------------------------------------------------ lineage & change feed

/** Kind: table "core.field_lineage". For each golden field: which claim (source, value) won, and when. */
export const fieldLineage = core.table(
  "field_lineage",
  {
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    attribute: text("attribute").notNull(),
    claimId: bigRef("claim_id").references(() => claims.id, { onDelete: "set null" }),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    value: jsonb("value").$type<unknown>(),
    /** How many sources state a non-empty value for this attribute. */
    sourcesAgreeing: integer("sources_agreeing").notNull().default(1),
    sourcesTotal: integer("sources_total").notNull().default(1),
    decidedAt: ts("decided_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.companyId, t.attribute] })],
);

/** Kind: table "core.changes". Every change the pipeline notices: alerts, "recently changed", analytics. */
export const changes = core.table(
  "changes",
  {
    id: bigId(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    sourceRecordId: bigRef("source_record_id").references(() => sourceRecords.id, { onDelete: "set null" }),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    kind: text("kind", { enum: CHANGE_KINDS }).notNull(),
    attribute: text("attribute"),
    oldValue: jsonb("old_value").$type<unknown>(),
    newValue: jsonb("new_value").$type<unknown>(),
    /** Who caused it: "staff:<email>" for console edits, "engine:<job>" (or null) for the pipeline. */
    actor: text("actor"),
    detectedAt: ts("detected_at").notNull().defaultNow(),
  },
  (t) => [index("changes_company_idx").on(t.companyId, t.detectedAt), index("changes_kind_idx").on(t.kind, t.detectedAt), index("changes_detected_idx").on(t.detectedAt)],
);

/**
 * Kind: table "core.row_history". Database-level safety net: triggers (baseline migration) copy old and new
 * versions of every changed row of the audited tables here, whoever made the change, including plain SQL.
 * `actor` comes from `set_config('app.actor', …)` (core/entity.ts withActor()).
 */
export const rowHistory = core.table(
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

export type Company = typeof companies.$inferSelect;
export type CompanyRelation = typeof companyRelations.$inferSelect;
export type ChangeEvent = typeof changes.$inferSelect;
export type ClassificationRule = typeof classificationRules.$inferSelect;
export type ActivityCategory = typeof activityCategories.$inferSelect;
export type RowHistory = typeof rowHistory.$inferSelect;
export type Person = typeof people.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type WebPresence = typeof webPresence.$inferSelect;
export type NewsMention = typeof newsMentions.$inferSelect;
export type FieldLineage = typeof fieldLineage.$inferSelect;
