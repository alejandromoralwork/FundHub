/**
 * FILE: services/engine/src/core/ops.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: Bookkeeping used by every job: run rows (`crawl_runs`), small per-source cursors
 *   (`source_cursors`), session health (`session_health`), and the census — the daily answer to
 *   "how many entities exist, how many are active, how many appeared or disappeared" (`census_snapshots`).
 * WHERE IT RUNS: engine workers and the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: Drizzle upserts, `sql<number>` typed SQL fragments, generics.
 */

import { and, eq, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { censusSnapshots, crawlRuns, sessionHealth, sourceCursors, type EngineSource, type RunStatus, type SessionState } from "@fundhub/engine-db/schema";

/** Kind: function. Today's date in Luxembourg as "YYYY-MM-DD". */
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Luxembourg" }).format(new Date());

/** Kind: async function. Opens a run row. @returns its id. */
export async function startRun(source: EngineSource, job: string, trigger: string, params: Record<string, unknown> = {}) {
  const [r] = await db.insert(crawlRuns).values({ source, job, trigger, params }).returning({ id: crawlRuns.id });
  return r.id;
}

/** Kind: async function. Closes a run row with its counters. */
export async function finishRun(id: number, status: RunStatus, stats: Record<string, number>, error?: string) {
  await db.update(crawlRuns).set({ status, stats, error: error?.slice(0, 2000) ?? null, finishedAt: new Date() }).where(eq(crawlRuns.id, id));
}

/** Kind: async function. Reads a cursor value (or undefined). */
export async function getCursor<T>(source: EngineSource, key: string): Promise<T | undefined> {
  const [r] = await db.select({ value: sourceCursors.value }).from(sourceCursors).where(and(eq(sourceCursors.source, source), eq(sourceCursors.key, key)));
  return r?.value as T | undefined;
}

/** Kind: async function. Writes a cursor value. */
export async function setCursor(source: EngineSource, key: string, value: unknown) {
  await db
    .insert(sourceCursors)
    .values({ source, key, value })
    .onConflictDoUpdate({ target: [sourceCursors.source, sourceCursors.key], set: { value, updatedAt: new Date() } });
}

/** Kind: async function. Adds `by` to a numeric cursor atomically. @returns the new value. */
export async function bumpCounter(source: EngineSource, key: string, by = 1): Promise<number> {
  const rows = await db.execute<{ value: number }>(sql`
    insert into source_cursors (source, key, value) values (${source}, ${key}, to_jsonb(${by}::int))
    on conflict (source, key) do update set value = to_jsonb(coalesce((source_cursors.value)::text::int, 0) + ${by}), updated_at = now()
    returning (value)::text::int as value`);
  return rows.rows[0].value;
}

/** Kind: async function. Records the state of a logged-in session. */
export async function setSessionHealth(source: EngineSource, state: SessionState, message?: string) {
  await db
    .insert(sessionHealth)
    .values({ source, state, message: message ?? null })
    .onConflictDoUpdate({ target: sessionHealth.source, set: { state, message: message ?? null, checkedAt: new Date() } });
}

/** Kind: async function. Reads the state of a session ("unknown" if never set). */
export async function getSessionHealth(source: EngineSource): Promise<SessionState> {
  const [r] = await db.select({ state: sessionHealth.state }).from(sessionHealth).where(eq(sessionHealth.source, source));
  return r?.state ?? "unknown";
}

/**
 * Kind: async function. Writes today's census row for one source scope (e.g. cssf / "SPP").
 * @param expectedTotal  what the source itself reports, when it does (CSSF totalElements, GLEIF total).
 */
export async function snapshotScope(source: string, scope: string, expectedTotal: number | null) {
  const [c] = (
    await db.execute<{ seen: number; added: number; gone: number }>(sql`
      select count(*) filter (where state = 'found')::int as seen,
             count(*) filter (where state = 'found' and first_seen_at >= current_date)::int as added,
             count(*) filter (where state = 'gone' and last_changed_at >= current_date)::int as gone
      from source_records where source = ${source} and scope = ${scope}`)
  ).rows;
  await upsertCensus(source, scope, { expectedTotal, seen: c.seen, active: c.seen, added: c.added, gone: c.gone });
}

/** Kind: async function. Upserts one census row for today. */
export async function upsertCensus(source: string, scope: string, v: { expectedTotal: number | null; seen: number; active: number | null; added: number | null; gone: number | null }) {
  const row = { takenOn: today(), source, scope, ...v };
  await db
    .insert(censusSnapshots)
    .values(row)
    .onConflictDoUpdate({ target: [censusSnapshots.takenOn, censusSnapshots.source, censusSnapshots.scope], set: v });
}

/**
 * Kind: async function. Registry-wide census over golden entities: totals by kind, service providers,
 * and by source coverage (how many entities are known to RCS, CSSF, GLEIF).
 */
export async function snapshotRegistry() {
  const rows = (
    await db.execute<{ scope: string; seen: number; active: number; added: number }>(sql`
      select 'all' as scope, count(*)::int as seen, count(*) filter (where status = 'active')::int as active, count(*) filter (where first_seen_at >= current_date)::int as added from entities
      union all
      select 'kind:' || entity_kind, count(*)::int, count(*) filter (where status = 'active')::int, count(*) filter (where first_seen_at >= current_date)::int from entities group by entity_kind
      union all
      select 'service_providers', count(*)::int, count(*) filter (where status = 'active')::int, count(*) filter (where first_seen_at >= current_date)::int from entities where is_service_provider
      union all
      select 'in:' || s.source, count(distinct s.entity_id)::int, null, null from source_records s where s.state = 'found' and s.entity_id is not null group by s.source`)
  ).rows;
  for (const r of rows) await upsertCensus("registry", r.scope, { expectedTotal: null, seen: r.seen, active: r.active, added: r.added, gone: null });
  return rows;
}
