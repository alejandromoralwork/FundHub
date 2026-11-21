/**
 * FILE: packages/engine-db/src/schema/match.ts
 * PART: shared package (packages/engine-db) — layer "match" (entity resolution and cross-checking)
 * WHAT IT DOES:
 *   - `candidates`: possible links between a source record and a company. Certain ones (shared RCS number,
 *     LEI…) are applied and recorded as "auto" for audit; uncertain ones (name only) wait as "pending".
 *     The applied link itself is `staging.source_records.company_id`.
 *   - `conflicts`: attributes where sources currently DISAGREE about a company (e.g. LBR says "struck off",
 *     GLEIF says "active"). The golden record still follows precedence; a person can resolve or ignore it.
 * WHERE IT RUNS: Node.js, drizzle-kit.
 */

import { index, jsonb, real, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { CONFLICT_STATUSES, MATCH_DECISIONS, MATCH_METHODS, type EngineSource } from "../enums";
import { companies } from "./core";
import { bigId, bigRef, match, ts } from "./shared";
import { sourceRecords } from "./staging";

/** Kind: table "match.candidates". A proposed (or applied, "auto") link source record → company. */
export const candidates = match.table(
  "candidates",
  {
    id: bigId(),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    method: text("method", { enum: MATCH_METHODS }).notNull(),
    score: real("score").notNull(),
    decision: text("decision", { enum: MATCH_DECISIONS }).notNull().default("pending"),
    decidedBy: text("decided_by"),
    decidedAt: ts("decided_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("candidates_uq").on(t.sourceRecordId, t.companyId), index("candidates_decision_idx").on(t.decision)],
);

/** Kind: type alias. One source's value in a conflict. */
export type ConflictValue = { source: EngineSource; value: unknown };

/** Kind: table "match.conflicts". One open disagreement per (company, attribute). */
export const conflicts = match.table(
  "conflicts",
  {
    id: bigId(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    attribute: text("attribute").notNull(),
    values: jsonb("values").$type<ConflictValue[]>().notNull(),
    /** The source whose value the golden record currently uses. */
    winner: text("winner"),
    status: text("status", { enum: CONFLICT_STATUSES }).notNull().default("open"),
    resolvedBy: text("resolved_by"),
    resolvedAt: ts("resolved_at"),
    note: text("note"),
    detectedAt: ts("detected_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("conflicts_uq").on(t.companyId, t.attribute), index("conflicts_status_idx").on(t.status, t.detectedAt)],
);

export type Candidate = typeof candidates.$inferSelect;
export type Conflict = typeof conflicts.$inferSelect;
