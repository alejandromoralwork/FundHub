/**
 * FILE: packages/engine-db/src/schema/shared.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: The Postgres SCHEMAS (namespaces) of the Intelligence database — one per pipeline layer — and
 *   small column helpers shared by every layer file.
 *     ops      pipeline control: sources, precedence, review policies, runs, quality, LBR capture tooling
 *     raw      landing zone, append-only: every fetch (bytes in object storage) and downloaded documents
 *     staging  one row per id at a source + every parsed version, with the optional human APPROVAL GATE
 *     clean    validated, normalized facts: attribute claims (history), rejects, licences, filings, pages, articles
 *     match    entity resolution and cross-checking: match candidates, conflicts between sources
 *     core     the golden records: companies, identifiers, names, relations, people, web presence, news, lineage
 *     mart     read-only SQL views for the console and analytics (created in the baseline migration)
 * WHERE IT RUNS: imported by the layer files and by drizzle-kit.
 * FRAMEWORK NOTES: `pgSchema("x").table(...)` creates tables inside schema x (SQL: `x.table`).
 */

import { bigint, bigserial, date, timestamp } from "drizzle-orm/pg-core";
import { pgSchema } from "drizzle-orm/pg-core";

export const ops = pgSchema("ops");
export const raw = pgSchema("raw");
export const staging = pgSchema("staging");
export const clean = pgSchema("clean");
export const match = pgSchema("match");
export const core = pgSchema("core");

/** `ts("x")` = timestamp with time zone. */
export const ts = (name: string) => timestamp(name, { withTimezone: true });
/** `day("x")` = a calendar date, handled as "YYYY-MM-DD" text in TypeScript (no time-zone surprises). */
export const day = (name: string) => date(name, { mode: "string" });
/** Big auto-numbered id, returned as a JS number (safe up to 9 quadrillion rows). */
export const bigId = () => bigserial("id", { mode: "number" }).primaryKey();
/** A bigint foreign-key column, as a JS number. */
export const bigRef = (name: string) => bigint(name, { mode: "number" });

/** Kind: type alias. A postal address as stored in jsonb. */
export type Address = { street?: string | null; postcode?: string | null; city?: string | null; country?: string | null; raw: string };

/** Kind: type alias. A stored logo: where the bytes are, where they came from, and their type. */
export type Logo = { blobKey: string; sourceUrl: string; mime: string; sha256: string; bytes: number };
