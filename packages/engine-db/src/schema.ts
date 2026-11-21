/**
 * FILE: packages/engine-db/src/schema.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: The Intelligence database schema, one Postgres schema per pipeline layer:
 *
 *   SOURCES ─▶ raw ─▶ staging ─▶ [approval gate] ─▶ clean ─▶ match ─▶ core ─▶ mart ─▶ publish ─▶ Website DB
 *              land    parse                        validate   resolve   golden   views   proposals
 *              ops: sources, precedence, review policies, runs, quality, census (spans all layers)
 *
 *   The tables live in ./schema/<layer>.ts; this file re-exports them all so imports stay
 *   `@fundhub/engine-db/schema`. The website never reads this database: the publish stage writes proposals
 *   into the website's `ingest_records`, and staff approve them in the console. See docs/data-pipeline.md.
 * WHERE IT RUNS: Node.js wherever the engine runs, and drizzle-kit (migrations).
 */

export * from "./enums";
export * from "./schema/shared";
export * from "./schema/ops";
export * from "./schema/raw";
export * from "./schema/staging";
export * from "./schema/clean";
export * from "./schema/match";
export * from "./schema/core";
