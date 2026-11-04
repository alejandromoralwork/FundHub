/**
 * Database access. The scraper only reads `providers` and writes the `ingest_*` tables;
 * in production its role (`fundhub_scraper`) cannot write anything else.
 *
 * FILE: services/scraper/src/store.ts
 * PART: scraper (services/scraper)
 * WHAT IT DOES: All the scraper's database work: load the providers to scrape (least recently scraped first),
 *   open and close a "run" log entry, work out which scraped facts differ from the live profile, save a
 *   pending record for staff review (replacing an older unreviewed one), and claim/finish jobs queued from
 *   the Console.
 * WHERE IT RUNS: on Node.js (GitHub Actions or a laptop), talking to Postgres.
 * FRAMEWORK NOTES: Drizzle ORM builds SQL from TypeScript: `db.select().from(t).where(...)`, `db.insert(t)
 *   .values(...)`, `db.update(t).set(...)`. The `sql` tag writes raw SQL where Drizzle has no shortcut; values
 *   put into ${…} are sent safely as parameters, and ${table} / ${column} insert their quoted names.
 * TYPESCRIPT YOU WILL SEE HERE: default parameter values (`opts = {}`, `limit = 20`), optional properties,
 *   `?.length`, ternaries returning `undefined`, `Promise<…>`, non-null `!`, union literal types,
 *   indexed access types (`Extraction["fields"]`), `as unknown as`, `Array.isArray`, spread `[...v]`,
 *   the `in` operator, generics `db.execute<{…}>`.
 */

// `import { a } from "b"` loads named exports. Drizzle helpers: and, asc (ascending), desc (descending),
// eq (equals), inArray (value IN list), sql (raw SQL tag).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
// `@fundhub/…` = our shared packages. The database connection.
import { db } from "@fundhub/db/client";
// Tables: queued jobs, pending records, run log, providers; plus the type of a source name.
import { ingestJobs, ingestRecords, ingestRuns, providers, type IngestSource } from "@fundhub/db/schema";
// Types only (`./types` = the file next to this one).
import type { Extraction, ProviderRef } from "./types";

/**
 * Kind: constant (object). The provider columns to fetch, matching the `ProviderRef` type field for field.
 */
const providerRef = {
  id: providers.id,
  slug: providers.slug,
  name: providers.name,
  website: providers.website,
  rcsNumber: providers.rcsNumber,
  headquarters: providers.headquarters,
  foundedYear: providers.foundedYear,
};

/**
 * Kind: async function (exported).
 * Published providers, least recently scraped first.
 * @param opts  optional filters: `slugs?` (only these URL slugs), `ids?` (only these ids), `limit?` (at most
 *              this many). `= {}` means "no filters" when nothing is passed.
 * @returns     `Promise<ProviderRef[]>`: the providers to process.
 */
export async function loadProviders(opts: { slugs?: string[]; ids?: number[]; limit?: number } = {}): Promise<ProviderRef[]> {
  // A small SQL sub-query: the date of this provider's newest scraped record (NULL if never scraped).
  const lastScraped = sql`(select max(${ingestRecords.createdAt}) from ${ingestRecords} where ${ingestRecords.providerId} = ${providers.id})`;
  // Build the query (not run yet).
  const q = db
    .select(providerRef)
    .from(providers)
    .where(
      // `and(...)` ignores `undefined` items, so each optional filter is added only when given.
      // `opts.slugs?.length` = the list's length if it exists (0 or undefined both count as "no").
      and(
        eq(providers.status, "published"),
        opts.slugs?.length ? inArray(providers.slug, opts.slugs) : undefined,
        opts.ids?.length ? inArray(providers.id, opts.ids) : undefined,
      ),
    )
    // Never-scraped first ("nulls first"), then oldest scrape first; ties broken by id.
    .orderBy(sql`${lastScraped} asc nulls first`, asc(providers.id));
  // With a limit, add LIMIT. A Drizzle query can be returned and awaited directly; that is when it runs.
  return opts.limit ? q.limit(opts.limit) : q;
}

/**
 * Kind: async function (exported).
 * Records the start of a run.
 * @param source   type `IngestSource` — "ai_web" or "rcs".
 * @param trigger  type `string` — what started it ("manual", "admin", …).
 * @returns        `Promise<number>`: the new run's id.
 */
export async function startRun(source: IngestSource, trigger: string): Promise<number> {
  // INSERT … RETURNING id. `[row]` = first (only) row; `row!` = surely present.
  const [row] = await db.insert(ingestRuns).values({ source, status: "running", trigger }).returning({ id: ingestRuns.id });
  return row!.id;
}

/**
 * Kind: async function (exported).
 * Closes a run with its final status, counts, optional error message, and finish time.
 * @param id      type `number` — the run id.
 * @param status  type `"succeeded" | "failed"` — exactly one of these two words.
 * @param stats   type `Record<string, number>` — the counts, e.g. { records: 3, failed: 0 }.
 * @param error   type `string`, optional (`?`) — the error message if it failed.
 * @returns       `Promise<void>`: nothing.
 */
export async function finishRun(id: number, status: "succeeded" | "failed", stats: Record<string, number>, error?: string) {
  await db.update(ingestRuns).set({ status, stats, error: error ?? null, finishedAt: new Date() }).where(eq(ingestRuns.id, id));
}

/**
 * Kind: constant holding an arrow function (private).
 * Turns a value into comparable text, so "same value" checks are fair:
 * lists are copied (`[...v]`), each item turned into text, and sorted (so order does not matter);
 * missing values become null. `Array.isArray(v)` = "is v a list?".
 * @param v  type `unknown` — any value.
 * @returns  `string`: the JSON text form.
 */
const normalizeValue = (v: unknown) => JSON.stringify(Array.isArray(v) ? [...v].map(String).sort() : v ?? null);

/**
 * Kind: async function (exported).
 * Keeps only fields whose scraped value differs from the live profile.
 * @param ext  type `Extraction` — what the source found.
 * @returns    `Promise<Extraction["fields"]>` (the same type as the extraction's `fields`): only the changed ones.
 */
export async function changedFields(ext: Extraction): Promise<Extraction["fields"]> {
  // The provider's live row (all columns).
  const [live] = await db.select().from(providers).where(eq(providers.id, ext.provider.id));
  if (!live) return {};
  // Treat the row as "any text key -> any value" so we can read a column by a name held in a variable.
  const current = live as unknown as Record<string, unknown>;
  // Keep a field if the column does not exist on the provider (`!(k in current)`), or its value differs.
  // `Object.entries` -> [key, field] pairs; `.filter` keeps some; `Object.fromEntries` rebuilds the object.
  return Object.fromEntries(
    Object.entries(ext.fields).filter(([k, f]) => !(k in current) || normalizeValue(current[k]) !== normalizeValue(f.value)),
  );
}

/**
 * Kind: async function (exported).
 * One pending record per provider and source: a newer scrape replaces the unreviewed one.
 * @param runId   type `number` — the run that produced it.
 * @param source  type `IngestSource` — which source.
 * @param ext     type `Extraction` — the (already filtered) findings.
 * @returns       `Promise<number>`: the record's id.
 */
export async function saveRecord(runId: number, source: IngestSource, ext: Extraction): Promise<number> {
  // The values written in both cases (update or insert).
  const values = { runId, sourceUrl: ext.sourceUrl, raw: ext.raw, extracted: ext.fields, createdAt: new Date() };
  // Is there already a pending record for this provider and source? Take the newest.
  const [pending] = await db
    .select({ id: ingestRecords.id })
    .from(ingestRecords)
    .where(and(eq(ingestRecords.providerId, ext.provider.id), eq(ingestRecords.source, source), eq(ingestRecords.status, "pending")))
    .orderBy(desc(ingestRecords.id))
    .limit(1);
  // Yes: overwrite it, so reviewers only ever see the latest findings.
  if (pending) {
    await db.update(ingestRecords).set(values).where(eq(ingestRecords.id, pending.id));
    return pending.id;
  }
  // No: insert a new pending record. `{ ...values, … }` copies `values` and adds three more fields.
  const [row] = await db
    .insert(ingestRecords)
    .values({ ...values, providerId: ext.provider.id, source, status: "pending" })
    .returning({ id: ingestRecords.id });
  return row!.id;
}

/**
 * Kind: async function (exported).
 * Atomically takes queued jobs (safe if two workers run at once).
 * @param limit  type `number`, default 20 — at most this many jobs.
 * @returns      `Promise<{ id, source, providerId }[]>`: the jobs now marked "running".
 */
export async function claimJobs(limit = 20) {
  // One SQL statement that both picks and marks the jobs, so two scrapers cannot take the same job:
  // "for update skip locked" makes Postgres lock the chosen rows and skip rows another worker has locked.
  // `db.execute<{…}>` is generic: the part in <> describes each returned row.
  const { rows } = await db.execute<{ id: number; source: IngestSource; provider_id: number | null }>(sql`
    update ${ingestJobs} set status = 'running', updated_at = now()
    where id in (select id from ${ingestJobs} where status = 'queued' order by id for update skip locked limit ${limit})
    returning id, source, provider_id`);
  // Rename the database's snake_case column to camelCase for the rest of the code.
  return rows.map((r) => ({ id: r.id, source: r.source, providerId: r.provider_id }));
}

/**
 * Kind: async function (exported).
 * Marks a job finished.
 * @param id      type `number` — the job id.
 * @param status  type `"done" | "failed"`.
 * @param runId   type `number | null` — the run that handled it (null if it failed before a run existed).
 * @param error   optional `string` — the error message.
 * @returns       `Promise<void>`: nothing.
 */
export async function finishJob(id: number, status: "done" | "failed", runId: number | null, error?: string) {
  await db.update(ingestJobs).set({ status, runId, error: error ?? null }).where(eq(ingestJobs.id, id));
}
