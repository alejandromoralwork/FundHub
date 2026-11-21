/**
 * FILE: packages/engine-db/src/schema/staging.ts
 * PART: shared package (packages/engine-db) — layer "staging"
 * WHAT IT DOES:
 *   - `source_records`: one row per (source, external id) — e.g. ("cssf", "7013419"), ("rcs", "B145917").
 *     Remembers whether the id exists, which company it resolved to, and when to fetch it again.
 *   - `parsed_records`: every parsed VERSION of a record (parser output, per source vocabulary), and the
 *     optional human APPROVAL GATE: a review policy (ops.review_policies) may hold a version as "pending";
 *     nothing reaches clean / match / core until a person approves (or edits and approves) it.
 *     `source_records.released_parsed_id` / `released` = the last version that went downstream, which is
 *     what the next version is compared with.
 * WHERE IT RUNS: Node.js (engine workers, admin console), drizzle-kit.
 */

import { index, integer, jsonb, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ENGINE_SOURCES, REVIEW_STATUSES, SOURCE_RECORD_STATES } from "../enums";
import { companies } from "./core";
import { fetches } from "./raw";
import { bigId, bigRef, staging, ts } from "./shared";

/** Kind: table "staging.source_records". One row per id at a source. `next_fetch_at` drives rolling refresh. */
export const sourceRecords = staging.table(
  "source_records",
  {
    id: bigId(),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    externalId: text("external_id").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    state: text("state", { enum: SOURCE_RECORD_STATES }).notNull().default("found"),
    /** Grouping at the source, e.g. the CSSF entity type "SPP" or the RCS prefix "B". */
    scope: text("scope"),
    latestFetchId: bigRef("latest_fetch_id"),
    /** The last parsed version released downstream (approved or not requiring review). */
    releasedParsedId: bigRef("released_parsed_id"),
    /** Its content hash and content, kept here for cheap change detection and diffs. */
    contentHash: text("content_hash"),
    released: jsonb("released").$type<Record<string, unknown>>(),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    firstSeenAt: ts("first_seen_at").notNull().defaultNow(),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
    lastChangedAt: ts("last_changed_at").notNull().defaultNow(),
    nextFetchAt: ts("next_fetch_at"),
  },
  (t) => [
    uniqueIndex("source_records_source_ext_uq").on(t.source, t.externalId),
    index("source_records_company_idx").on(t.companyId),
    index("source_records_due_idx").on(t.source, t.nextFetchAt),
    index("source_records_scope_idx").on(t.source, t.scope),
  ],
);

/** Kind: table "staging.parsed_records". Each parsed version of a record + its approval-gate state. */
export const parsedRecords = staging.table(
  "parsed_records",
  {
    id: bigId(),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    fetchId: bigRef("fetch_id").references(() => fetches.id, { onDelete: "set null" }),
    parserVersion: integer("parser_version").notNull(),
    /** sha256 of the canonical parsed JSON (stable across cosmetic page changes). */
    contentHash: text("content_hash").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    reviewStatus: text("review_status", { enum: REVIEW_STATUSES }).notNull().default("not_required"),
    /** Why it was held, e.g. ["protected attribute changed: status", "new company"]. */
    reviewReasons: jsonb("review_reasons").$type<string[]>(),
    /** The policy that held it (ops.review_policies.id). */
    reviewPolicyId: integer("review_policy_id"),
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    reviewNote: text("review_note"),
    /** The reviewer's corrected version; used instead of `payload` when status = "edited". */
    editedPayload: jsonb("edited_payload").$type<Record<string, unknown>>(),
    /** When it went downstream (clean → core). Null while pending / rejected. */
    releasedAt: ts("released_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("parsed_records_record_idx").on(t.sourceRecordId, t.createdAt),
    index("parsed_records_review_idx").on(t.reviewStatus, t.createdAt),
  ],
);

export type SourceRecord = typeof sourceRecords.$inferSelect;
export type ParsedRecordRow = typeof parsedRecords.$inferSelect;
