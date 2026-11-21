/**
 * FILE: packages/engine-db/src/schema/clean.ts
 * PART: shared package (packages/engine-db) — layer "clean" (validated, normalized, common vocabulary)
 * WHAT IT DOES: What each source says, after validation and normalization (names, LU postcodes, countries,
 *   phones, URLs, dates) and in FundHub's vocabulary rather than the source's:
 *   - `claims`: attribute-level facts with provenance and history ("SCD type 2"): the open row
 *     (valid_to IS NULL) is the source's current claim; a change closes it and opens a new one. The
 *     consolidate stage picks golden values from these.
 *   - `rejects`: values that failed validation, with the reason (data-quality signal, never silently dropped).
 *   - typed details too rich for claims: CSSF `licences`, LBR `filings`, crawled `web_pages`, news `articles`.
 * WHERE IT RUNS: Node.js, drizzle-kit.
 */

import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, real, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { ENGINE_SOURCES, WEB_PAGE_KINDS } from "../enums";
import { companies } from "./core";
import { newsFeeds } from "./ops";
import { documents } from "./raw";
import { bigId, bigRef, clean, day, ts } from "./shared";
import { parsedRecords, sourceRecords } from "./staging";

/** Kind: table "clean.claims". One normalized attribute value stated by one source record, with history. */
export const claims = clean.table(
  "claims",
  {
    id: bigId(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    attribute: text("attribute").notNull(),
    value: jsonb("value").$type<unknown>(),
    confidence: real("confidence").notNull().default(1),
    parsedRecordId: bigRef("parsed_record_id").references(() => parsedRecords.id, { onDelete: "set null" }),
    validFrom: ts("valid_from").notNull().defaultNow(),
    validTo: ts("valid_to"),
  },
  (t) => [
    index("claims_open_idx").on(t.sourceRecordId, t.attribute).where(sql`valid_to is null`),
    index("claims_company_idx").on(t.companyId, t.attribute),
  ],
);

/** Kind: table "clean.rejects". A value that failed validation in the clean stage. */
export const rejects = clean.table(
  "rejects",
  {
    id: bigId(),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    parsedRecordId: bigRef("parsed_record_id").references(() => parsedRecords.id, { onDelete: "set null" }),
    source: text("source", { enum: ENGINE_SOURCES }).notNull(),
    attribute: text("attribute").notNull(),
    value: jsonb("value").$type<unknown>(),
    reason: text("reason").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("rejects_created_idx").on(t.createdAt), index("rejects_record_idx").on(t.sourceRecordId)],
);

/**
 * Kind: table "clean.licences". The detail lines of a CSSF register entry: authorised statuses (ACT_…),
 * other statuses (OST_…), investment services (SER_/ANC_/SERVPAY_…) and fund compartments.
 */
export const licences = clean.table(
  "licences",
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
  (t) => [uniqueIndex("licences_uq").on(t.sourceRecordId, t.detailType, t.code), index("licences_code_idx").on(t.code)],
);

/**
 * Kind: table "clean.filings". The filings ("dépôts") of an RCS company, e.g. L260377560 "Authorized
 * signature list". A filing number never changes, so a NEW number = a new filing.
 */
export const filings = clean.table(
  "filings",
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
  (t) => [index("filings_record_idx").on(t.sourceRecordId, t.filingDate), index("filings_doc_todo_idx").on(t.documentSha256)],
);

/** Kind: table "clean.web_pages". Pages crawled from a company website (text in object storage). */
export const webPages = clean.table(
  "web_pages",
  {
    id: bigId(),
    sourceRecordId: bigRef("source_record_id").notNull().references(() => sourceRecords.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    kind: text("kind", { enum: WEB_PAGE_KINDS }).notNull().default("other"),
    title: text("title"),
    textBlobKey: text("text_blob_key"),
    lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("web_pages_uq").on(t.sourceRecordId, t.url)],
);

/** Kind: table "clean.articles". A news article (one per source record of source "news"). */
export const articles = clean.table(
  "articles",
  {
    id: bigId(),
    sourceRecordId: bigRef("source_record_id").notNull().unique().references(() => sourceRecords.id, { onDelete: "cascade" }),
    feedId: integer("feed_id").references(() => newsFeeds.id, { onDelete: "set null" }),
    url: text("url").notNull().unique(),
    title: text("title").notNull(),
    publishedAt: ts("published_at"),
    author: text("author"),
    language: text("language"),
    snippet: text("snippet"),
    textBlobKey: text("text_blob_key"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("articles_published_idx").on(t.publishedAt)],
);

export type ClaimRow = typeof claims.$inferSelect;
export type Reject = typeof rejects.$inferSelect;
export type Licence = typeof licences.$inferSelect;
export type Filing = typeof filings.$inferSelect;
export type Article = typeof articles.$inferSelect;
