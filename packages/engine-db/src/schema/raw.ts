/**
 * FILE: packages/engine-db/src/schema/raw.ts
 * PART: shared package (packages/engine-db) — layer "raw" (landing zone)
 * WHAT IT DOES: Append-only record of everything acquired. `fetches` = one row per fetch / upload / capture
 *   whose content changed (unchanged content only bumps staging.source_records.last_seen_at); the bytes live
 *   in object storage under `blob_key` (content-addressed by sha256, so identical pages are stored once).
 *   `documents` = downloaded files (filing PDFs…). Nothing here is ever updated, so any later stage can be
 *   re-run from raw after a parser or cleaning fix, without re-scraping.
 * WHERE IT RUNS: Node.js, drizzle-kit.
 */

import { index, integer, text } from "drizzle-orm/pg-core";
import { ENGINE_SOURCES, TEXT_STATUSES } from "../enums";
import { runs } from "./ops";
import { bigId, bigRef, raw, ts } from "./shared";
import { sourceRecords } from "./staging";

/** Kind: table "raw.fetches". Every acquired content version, immutable. */
export const fetches = raw.table(
  "fetches",
  {
    id: bigId(),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    runId: integer("run_id").references(() => runs.id, { onDelete: "set null" }),
    url: text("url").notNull(),
    httpStatus: integer("http_status"),
    contentType: text("content_type"),
    bytes: integer("bytes"),
    /** sha256 of the raw bytes. */
    rawHash: text("raw_hash").notNull(),
    blobKey: text("blob_key").notNull(),
    fetchedAt: ts("fetched_at").notNull().defaultNow(),
  },
  (t) => [index("fetches_record_idx").on(t.sourceRecordId, t.fetchedAt), index("fetches_fetched_idx").on(t.fetchedAt)],
);

/** Kind: table "raw.documents". Downloaded files keyed by sha256; text extraction stores plain text too. */
export const documents = raw.table("documents", {
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

export type Fetch = typeof fetches.$inferSelect;
export type Document = typeof documents.$inferSelect;
