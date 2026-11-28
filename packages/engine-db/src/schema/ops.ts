/**
 * FILE: packages/engine-db/src/schema/ops.ts
 * PART: shared package (packages/engine-db) — layer "ops" (pipeline control; spans every other layer)
 * WHAT IT DOES:
 *   - `sources`: the source registry (display name, system, kind, acquisition, trust, enabled, refresh…).
 *   - `attribute_precedence`: which source wins each golden field (lower rank = more trusted). Editable.
 *   - `review_policies`: the optional human approval gate at staging, per source (and scope).
 *   - `runs`, `cursors`, `settings`, `session_health`: job executions, per-source state, console settings.
 *   - `quality_checks` / `quality_results`: data-quality measures over time.
 *   - `census_snapshots`: "how many exist" per source/scope per day (coverage vs the LBR census).
 *   - LBR capture tooling: `lbr_number_space`, `lbr_capture_rounds` (+ items), `lbr_search_words`.
 *   - `news_feeds`: the RSS feeds polled by the news source.
 * WHERE IT RUNS: Node.js, drizzle-kit.
 */

import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, primaryKey, real, serial, text, uniqueIndex } from "drizzle-orm/pg-core";
import { ACQUISITION_METHODS, ENGINE_SOURCES, LAYERS, REVIEW_MODES, RUN_STATUSES, SESSION_STATES, SOURCE_KINDS } from "../enums";
import { day, ops, ts } from "./shared";

// ------------------------------------------------------------------ source registry & rules

/** Kind: table "ops.sources". One row per source code (see enums.ts ENGINE_SOURCES). */
export const sources = ops.table("sources", {
  code: text("code", { enum: ENGINE_SOURCES }).primaryKey(),
  /** The source system it belongs to, e.g. "LBR" for both "rcs" and "lbr_bulk". */
  system: text("system").notNull(),
  name: text("name").notNull(),
  kind: text("kind", { enum: SOURCE_KINDS }).notNull(),
  acquisition: text("acquisition", { enum: ACQUISITION_METHODS }).notNull(),
  homepage: text("homepage"),
  description: text("description"),
  /** Default trust, 1 (highest) … 9; attribute_precedence refines it per attribute. */
  trust: integer("trust").notNull().default(5),
  enabled: boolean("enabled").notNull().default(true),
  /** Days between refreshes of a record (by tier: [tier0, tier1, tier2]); null = driven by deltas/listings. */
  refreshDays: jsonb("refresh_days").$type<[number, number, number]>(),
  /** Requests per minute the fetchers allow themselves. */
  rateLimitPerMin: integer("rate_limit_per_min"),
  /** Terms-of-use / GDPR notes shown in the console (what may be collected, retention). */
  complianceNote: text("compliance_note"),
  /** Personal data retention for this source (people, positions), in days; null = keep. */
  retentionDays: integer("retention_days"),
  sort: integer("sort").notNull().default(0),
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Kind: table "ops.attribute_precedence". For each golden attribute, the sources allowed and their rank. */
export const attributePrecedence = ops.table(
  "attribute_precedence",
  {
    attribute: text("attribute").notNull(),
    source: text("source", { enum: ENGINE_SOURCES }).notNull().references(() => sources.code, { onDelete: "cascade" }),
    /** 0 = most trusted. "manual" is always 0. */
    rank: integer("rank").notNull(),
  },
  (t) => [primaryKey({ columns: [t.attribute, t.source] })],
);

/** Kind: type alias. When a "review_if" policy holds a record. Every set condition is OR-ed. */
export type ReviewConditions = {
  /** First version ever of a record at this source. */
  newRecord?: boolean;
  /** The record would create a new company (no match found). */
  newCompany?: boolean;
  /** The parser version changed since the released version. */
  parserChanged?: boolean;
  /** Any of these attributes changed vs the released version (e.g. ["name","status","rcsNumber","lei","address"]). */
  protectedAttributes?: string[];
  /** Hold when the record's own confidence (AI extraction) is below this. */
  minConfidence?: number;
};

/** Kind: table "ops.review_policies". The staging approval gate. source "*" = default for every source. */
export const reviewPolicies = ops.table(
  "review_policies",
  {
    id: serial("id").primaryKey(),
    /** A source code, or "*" for all. */
    source: text("source").notNull(),
    /** A scope at the source (e.g. CSSF type "SPP"), or "*" for all. The most specific enabled policy applies. */
    scope: text("scope").notNull().default("*"),
    mode: text("mode", { enum: REVIEW_MODES }).notNull().default("auto"),
    conditions: jsonb("conditions").$type<ReviewConditions>().notNull().default(sql`'{}'::jsonb`),
    /** For mode "sample": the share of records held for spot checks (0…1). */
    sampleRate: real("sample_rate").notNull().default(0),
    enabled: boolean("enabled").notNull().default(true),
    note: text("note"),
    updatedBy: text("updated_by"),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("review_policies_uq").on(t.source, t.scope)],
);

// ------------------------------------------------------------------ runs & state

/** Kind: table "ops.runs". One row per job execution: which job, how it went, counters. */
export const runs = ops.table(
  "runs",
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
  (t) => [index("runs_started_idx").on(t.startedAt), index("runs_source_idx").on(t.source, t.startedAt)],
);

/** Kind: table "ops.cursors". Small key/value state per source, e.g. GLEIF "last delta at". */
export const cursors = ops.table(
  "cursors",
  {
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    key: text("key").notNull(),
    value: jsonb("value").$type<unknown>(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.source, t.key] })],
);

/** Kind: table "ops.settings". Key/value settings changed from the console, e.g. "disabled_schedules". */
export const settings = ops.table("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>(),
  updatedBy: text("updated_by"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Kind: table "ops.session_health". State of logged-in sessions (RCS / LuxTrust). Workers pause when not "ok". */
export const sessionHealth = ops.table("session_health", {
  source: text("source", { enum: ENGINE_SOURCES }).primaryKey(),
  state: text("state", { enum: SESSION_STATES }).notNull().default("unknown"),
  message: text("message"),
  checkedAt: ts("checked_at").notNull().defaultNow(),
});

// ------------------------------------------------------------------ data quality

/** Kind: table "ops.quality_checks". A named measure, computed by the `quality_run` job (pipeline/quality.ts). */
export const qualityChecks = ops.table("quality_checks", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  description: text("description").notNull(),
  layer: text("layer", { enum: LAYERS }).notNull(),
  /** Pass when value >= min (or <= max). Values are ratios 0…1 unless the description says otherwise. */
  min: real("min"),
  max: real("max"),
  enabled: boolean("enabled").notNull().default(true),
  sort: integer("sort").notNull().default(0),
});

/** Kind: table "ops.quality_results". One measurement of a check (optionally per scope, e.g. per source). */
export const qualityResults = ops.table(
  "quality_results",
  {
    id: serial("id").primaryKey(),
    checkCode: text("check_code").notNull().references(() => qualityChecks.code, { onDelete: "cascade" }),
    scope: text("scope").notNull().default("all"),
    value: real("value"),
    numerator: integer("numerator"),
    denominator: integer("denominator"),
    passed: boolean("passed"),
    measuredAt: ts("measured_at").notNull().defaultNow(),
  },
  (t) => [index("quality_results_check_idx").on(t.checkCode, t.scope, t.measuredAt)],
);

/**
 * Kind: table "ops.census_snapshots". "How many exist" per source and scope, per day: `expected_total` =
 * what the source reports (CSSF totals, GLEIF total), `seen` = what we hold, `active`, `added`, `gone`.
 */
export const censusSnapshots = ops.table(
  "census_snapshots",
  {
    id: serial("id").primaryKey(),
    takenOn: day("taken_on").notNull(),
    /** A source code, or "registry" for counts over golden companies (by kind, service providers…). */
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

// ------------------------------------------------------------------ LBR capture tooling

/**
 * Kind: table "ops.lbr_number_space". RCS numbers are sequential per prefix letter (B = commercial companies…).
 * `max_known` = highest number seen to exist (the "frontier"); `swept_to` = backfill progress.
 */
export const lbrNumberSpace = ops.table("lbr_number_space", {
  prefix: text("prefix").primaryKey(),
  label: text("label").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  maxKnown: integer("max_known").notNull().default(0),
  sweptTo: integer("swept_to").notNull().default(0),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Kind: type alias. Which companies a capture round covers. */
export type RoundScope = { filter: "all" | "sp" | "am" | "cssf" | "text"; text?: string; skipCapturedWithinDays?: number };

/**
 * Kind: table "ops.lbr_capture_rounds". A planned pass over a list of RCS companies that a person works through
 * in the browser (FundHub LBR Capture extension). At most one round is active.
 */
export const lbrCaptureRounds = ops.table(
  "lbr_capture_rounds",
  {
    id: serial("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind", { enum: ["initial", "update"] }).notNull(),
    scope: jsonb("scope").$type<RoundScope>().notNull(),
    status: text("status", { enum: ["active", "closed"] }).notNull().default("active"),
    createdBy: text("created_by"),
    notes: text("notes"),
    startedAt: ts("started_at").notNull().defaultNow(),
    closedAt: ts("closed_at"),
  },
  (t) => [uniqueIndex("lbr_capture_rounds_one_active_uq").on(t.status).where(sql`status = 'active'`)],
);

/** Kind: constant. States of one company within a round. */
export const ROUND_ITEM_STATUSES = ["pending", "captured", "changed", "unchanged", "not_found", "skipped", "failed"] as const;

/** Kind: table "ops.lbr_capture_round_items". One company of a round and what happened when it was visited. */
export const lbrCaptureRoundItems = ops.table(
  "lbr_capture_round_items",
  {
    roundId: integer("round_id").notNull().references(() => lbrCaptureRounds.id, { onDelete: "cascade" }),
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
  (t) => [primaryKey({ columns: [t.roundId, t.rcs] }), index("lbr_capture_round_items_next_idx").on(t.roundId, t.status, t.position)],
);

/** Kind: constant. States of one word of the LBR search sweep. */
export const SWEEP_WORD_STATUSES = ["pending", "done", "skipped"] as const;

/**
 * Kind: table "ops.lbr_search_words". The LBR SEARCH SWEEP: words searched one by one on lbr.lu by a person
 * (the extension). LBR matches whole words and lists at most 199 results. Phase 1 = aa…zz, 2 = aaa…zzz,
 * 3 = words of known names, most common first. Companies found go through the normal pipeline ("lbr_bulk").
 */
export const lbrSearchWords = ops.table(
  "lbr_search_words",
  {
    term: text("term").primaryKey(),
    status: text("status", { enum: SWEEP_WORD_STATUSES }).notNull().default("pending"),
    seen: integer("seen").notNull().default(0),
    origin: text("origin", { enum: ["letters", "seed", "results"] }).notNull().default("seed"),
    phase: integer("phase").notNull().default(3),
    total: integer("total"),
    rows: integer("rows"),
    newNumbers: integer("new_numbers"),
    capped: boolean("capped"),
    searchedAt: ts("searched_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("lbr_search_words_next_idx").on(t.status, t.phase, t.seen)],
);

// ------------------------------------------------------------------ news

/** Kind: table "ops.news_feeds". RSS/Atom feeds polled by the `news_poll` job. */
export const newsFeeds = ops.table("news_feeds", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull().unique(),
  language: text("language"),
  enabled: boolean("enabled").notNull().default(true),
  etag: text("etag"),
  lastModified: text("last_modified"),
  lastPolledAt: ts("last_polled_at"),
  lastError: text("last_error"),
  articles: integer("articles").notNull().default(0),
});

export type Source = typeof sources.$inferSelect;
export type ReviewPolicy = typeof reviewPolicies.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type CaptureRound = typeof lbrCaptureRounds.$inferSelect;
export type CaptureRoundItem = typeof lbrCaptureRoundItems.$inferSelect;
export type LbrSearchWord = typeof lbrSearchWords.$inferSelect;
export type NewsFeed = typeof newsFeeds.$inferSelect;
export type QualityCheck = typeof qualityChecks.$inferSelect;

/**
 * Kind: table "ops.mandate_roles". The roles a service provider can hold for a fund (depositary, central
 * administration, auditor, ManCo / AIFM…). `exclusive` = one provider at a time per fund: the database refuses
 * two overlapping current mandates for such a role (core.mandates exclusion constraint). Seeded from seed-data.ts.
 */
export const mandateRoles = ops.table("mandate_roles", {
  code: text("code").primaryKey(),
  label: text("label").notNull(),
  exclusive: boolean("exclusive").notNull(),
  /** A CSSF-licensed activity (depositary, central administration, ManCo / AIFM…). */
  regulated: boolean("regulated").notNull().default(false),
  /** "fund", "sub_fund" or "both". */
  appliesTo: text("applies_to").notNull().default("both"),
  sort: integer("sort").notNull().default(0),
});
export type MandateRoleRow = typeof mandateRoles.$inferSelect;
