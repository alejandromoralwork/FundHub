/**
 * FILE: apps/admin/src/lib/engine-data.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The read queries behind the "Scraping Engine" pages: dashboard (census, coverage, session, queue,
 *   runs, change feed), the registry list with filters, one entity with everything known about it and its full
 *   history, pending match candidates, and the jobs page. All read the engine database (packages/engine-db).
 *   Results are converted to plain JSON (dates → strings) before they are handed to client components.
 * WHERE IT RUNS: server only (server components call these).
 * TYPESCRIPT YOU WILL SEE HERE: `sql<…>` typed raw queries, `Promise.all`, a JSON round-trip for serialisation.
 */

import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db as engineDb } from "@fundhub/engine-db/client";
import { DISABLED_SCHEDULES_KEY, JOB_CATALOG } from "@fundhub/engine-db/jobs-catalog";
import { PRECEDENCE } from "@fundhub/engine-db/core/golden";
import {
  activityCategories,
  censusSnapshots,
  changeEvents,
  crawlRuns,
  cssfDetails,
  engineSettings,
  entities,
  entityIdentifiers,
  entityNames,
  entityRelations,
  observations,
  rcsFilings,
  rcsNumberSpace,
  rowHistory,
  sessionHealth,
  sourceRecords,
  ENTITY_KINDS,
  ENTITY_STATUSES,
  ENGINE_SOURCES,
} from "@fundhub/engine-db/schema";

/** Kind: type alias. What a value looks like after a JSON round-trip: Dates become strings, recursively. */
export type Jsonify<T> = T extends Date ? string : T extends (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;
/** Kind: function. Plain JSON copy (Dates → ISO strings), safe to pass to client components. */
const plain = <T,>(v: T): Jsonify<T> => JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? Number(x) : x)));

/** Kind: async function. Runs a query on pg-boss tables, which do not exist until a worker started once. */
async function queueQuery<T extends Record<string, unknown>>(q: SQL): Promise<T[] | null> {
  try {
    return (await engineDb.execute<T>(q)).rows as T[];
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ dashboard

/** Kind: async function. Everything the /engine dashboard shows. */
export async function engineDashboard() {
  const [census, trend, sessions, runs, events, space, queue] = await Promise.all([
    engineDb.select().from(censusSnapshots).where(sql`${censusSnapshots.takenOn} = (select max(taken_on) from census_snapshots)`).orderBy(censusSnapshots.source, censusSnapshots.scope),
    engineDb
      .select({ day: censusSnapshots.takenOn, scope: censusSnapshots.scope, seen: censusSnapshots.seen })
      .from(censusSnapshots)
      .where(and(eq(censusSnapshots.source, "registry"), sql`${censusSnapshots.scope} in ('all', 'service_providers')`))
      .orderBy(desc(censusSnapshots.takenOn))
      .limit(60),
    engineDb.select().from(sessionHealth),
    engineDb.select().from(crawlRuns).orderBy(desc(crawlRuns.startedAt)).limit(15),
    engineDb
      .select({ id: changeEvents.id, kind: changeEvents.kind, source: changeEvents.source, attribute: changeEvents.attribute, newValue: changeEvents.newValue, actor: changeEvents.actor, detectedAt: changeEvents.detectedAt, entityId: changeEvents.entityId, entityName: entities.canonicalName })
      .from(changeEvents)
      .leftJoin(entities, eq(entities.id, changeEvents.entityId))
      .orderBy(desc(changeEvents.id))
      .limit(30),
    engineDb.select().from(rcsNumberSpace).orderBy(rcsNumberSpace.prefix),
    queueQuery<{ name: string; state: string; n: number }>(sql`select name, state, count(*)::int as n from pgboss.job group by 1, 2 order by 1, 2`),
  ]);
  const [totals] = (
    await engineDb.execute<{ entities: number; service_providers: number; with_rcs: number; with_lei: number; pending_matches: number }>(sql`
      select (select count(*) from entities)::int as entities,
             (select count(*) from entities where is_service_provider)::int as service_providers,
             (select count(*) from entities where rcs_number is not null)::int as with_rcs,
             (select count(*) from entities where lei is not null)::int as with_lei,
             (select count(*) from match_candidates where decision = 'pending')::int as pending_matches`)
  ).rows;
  return plain({ census, trend, sessions, runs, events, space, queue, totals });
}

// ------------------------------------------------------------------ registry list

/** Kind: type alias. Filters of the registry list (all optional, from the URL). */
export type RegistryFilters = {
  q?: string;
  kind?: string;
  sp?: string;
  category?: string;
  status?: string;
  tier?: string;
  source?: string;
  rcs?: string;
  page?: string;
};

/** Kind: async function. One page of entities matching the filters, plus the total. */
export async function registryList(f: RegistryFilters) {
  const pageSize = 50;
  const page = Math.max(1, Number(f.page) || 1);
  const conds: SQL[] = [];
  if (f.q?.trim()) {
    const term = `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(
      or(
        ilike(entities.canonicalName, term),
        ilike(entities.rcsNumber, term),
        ilike(entities.lei, term),
        sql`exists (select 1 from entity_identifiers i where i.entity_id = entities.id and i.value ilike ${term})`,
        sql`exists (select 1 from entity_names n where n.entity_id = entities.id and n.name ilike ${term})`,
      )!,
    );
  }
  if (f.kind && (ENTITY_KINDS as readonly string[]).includes(f.kind)) conds.push(eq(entities.entityKind, f.kind as (typeof ENTITY_KINDS)[number]));
  if (f.sp === "yes") conds.push(eq(entities.isServiceProvider, true));
  if (f.sp === "no") conds.push(eq(entities.isServiceProvider, false));
  if (f.category && Number(f.category)) conds.push(or(eq(entities.activityCategoryId, Number(f.category)), eq(entities.activitySubcategoryId, Number(f.category)))!);
  if (f.status && (ENTITY_STATUSES as readonly string[]).includes(f.status)) conds.push(eq(entities.status, f.status as (typeof ENTITY_STATUSES)[number]));
  if (f.tier && /^[012]$/.test(f.tier)) conds.push(eq(entities.tier, Number(f.tier)));
  if (f.rcs === "yes") conds.push(sql`${entities.rcsNumber} is not null`);
  if (f.rcs === "no") conds.push(isNull(entities.rcsNumber));
  if (f.source && (ENGINE_SOURCES as readonly string[]).includes(f.source)) {
    conds.push(sql`exists (select 1 from source_records s where s.entity_id = entities.id and s.source = ${f.source} and s.state = 'found')`);
  }
  const where = conds.length ? and(...conds) : undefined;
  // Correlated subqueries name the outer table explicitly (`entities.id`): an interpolated column would render
  // as a bare "id", which Postgres would resolve to the inner table's id.
  const cat = sql<string | null>`(select label from activity_categories c where c.id = entities.activity_category_id)`;
  const sub = sql<string | null>`(select label from activity_categories c where c.id = entities.activity_subcategory_id)`;
  const sources = sql<string[]>`(select coalesce(array_agg(distinct s.source order by s.source), '{}') from source_records s where s.entity_id = entities.id and s.state = 'found')`;
  const [rows, [{ n }]] = await Promise.all([
    engineDb
      .select({
        id: entities.id,
        name: entities.canonicalName,
        rcsNumber: entities.rcsNumber,
        lei: entities.lei,
        status: entities.status,
        kind: entities.entityKind,
        sp: entities.isServiceProvider,
        tier: entities.tier,
        category: cat,
        subcategory: sub,
        sources,
        lastChangedAt: entities.lastChangedAt,
      })
      .from(entities)
      .where(where)
      .orderBy(asc(entities.canonicalName))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    engineDb.select({ n: count() }).from(entities).where(where),
  ]);
  return plain({ rows, total: n, page, pageSize });
}

/** Kind: async function. All activity categories (for filters and the edit form). */
export async function categoryOptions() {
  return plain(await engineDb.select({ id: activityCategories.id, slug: activityCategories.slug, label: activityCategories.label, parentId: activityCategories.parentId, level: activityCategories.level }).from(activityCategories).orderBy(activityCategories.level, activityCategories.sort));
}

// ------------------------------------------------------------------ one entity

/** Kind: async function. One entity with everything known about it and its history (null if unknown id). */
export async function entityDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [entity] = await engineDb.select().from(entities).where(eq(entities.id, id));
  if (!entity) return null;
  const [identifiers, names, records, open, history, relations, events, rows] = await Promise.all([
    engineDb.select().from(entityIdentifiers).where(eq(entityIdentifiers.entityId, id)),
    engineDb.select().from(entityNames).where(eq(entityNames.entityId, id)).orderBy(desc(entityNames.validFrom)),
    engineDb
      .select({ id: sourceRecords.id, source: sourceRecords.source, externalId: sourceRecords.externalId, state: sourceRecords.state, scope: sourceRecords.scope, lastSeenAt: sourceRecords.lastSeenAt, lastChangedAt: sourceRecords.lastChangedAt, nextFetchAt: sourceRecords.nextFetchAt, lastError: sourceRecords.lastError })
      .from(sourceRecords)
      .where(eq(sourceRecords.entityId, id)),
    engineDb.select({ source: observations.source, attribute: observations.attribute, value: observations.value, validFrom: observations.validFrom }).from(observations).where(and(eq(observations.entityId, id), isNull(observations.validTo))),
    engineDb
      .select({ id: observations.id, source: observations.source, attribute: observations.attribute, value: observations.value, validFrom: observations.validFrom, validTo: observations.validTo })
      .from(observations)
      .where(eq(observations.entityId, id))
      .orderBy(desc(observations.validFrom), desc(observations.id))
      .limit(300),
    engineDb.select().from(entityRelations).where(eq(entityRelations.subjectEntityId, id)).orderBy(isNull(entityRelations.validTo), entityRelations.objectName),
    engineDb.select().from(changeEvents).where(eq(changeEvents.entityId, id)).orderBy(desc(changeEvents.id)).limit(200),
    engineDb.select().from(rowHistory).where(and(eq(rowHistory.tableName, "entities"), eq(rowHistory.rowId, id))).orderBy(desc(rowHistory.id)).limit(50),
  ]);
  const recordIds = records.map((r) => r.id);
  const [details, filings, clientOf] = await Promise.all([
    recordIds.length ? engineDb.select().from(cssfDetails).where(sql`${cssfDetails.sourceRecordId} in ${recordIds}`).orderBy(cssfDetails.kind, cssfDetails.code) : [],
    recordIds.length ? engineDb.select().from(rcsFilings).where(sql`${rcsFilings.sourceRecordId} in ${recordIds}`).orderBy(desc(rcsFilings.filingDate)).limit(300) : [],
    engineDb
      .select({ id: entityRelations.id, kind: entityRelations.kind, providerId: entityRelations.subjectEntityId, providerName: entities.canonicalName, validTo: entityRelations.validTo })
      .from(entityRelations)
      .innerJoin(entities, eq(entities.id, entityRelations.subjectEntityId))
      .where(eq(entityRelations.objectEntityId, id)),
  ]);
  // Which source "won" each golden attribute: the first source in PRECEDENCE with a usable open claim.
  const usable = (v: unknown) => v !== null && v !== "" && v !== undefined && !(Array.isArray(v) && v.length === 0);
  const winners = Object.fromEntries(
    Object.entries(PRECEDENCE).map(([attr, order]) => [attr, order.find((s) => open.some((o) => o.source === s && o.attribute === attr && usable(o.value))) ?? null]),
  );
  return plain({ entity, identifiers, names, records, open, history, relations, events, rowHistory: rows, details, filings, clientOf, winners });
}

/** Kind: async function. Entities whose name matches (for linking a client to an entity). */
export async function searchEntities(q: string) {
  if (q.trim().length < 2) return [];
  return plain(await engineDb.select({ id: entities.id, name: entities.canonicalName, rcsNumber: entities.rcsNumber }).from(entities).where(ilike(entities.canonicalName, `%${q.trim()}%`)).limit(20));
}

// ------------------------------------------------------------------ matches

/** Kind: async function. Pending match candidates with both sides described. */
export async function pendingMatches() {
  const rows = (
    await engineDb.execute<{
      id: number;
      method: string;
      score: number;
      created_at: string;
      record_source: string;
      record_external_id: string;
      record_name: string | null;
      record_entity_id: string | null;
      record_entity_name: string | null;
      candidate_entity_id: string;
      candidate_name: string;
      candidate_rcs: string | null;
      candidate_address: string | null;
      record_address: string | null;
    }>(sql`
      select m.id, m.method, m.score, m.created_at,
             s.source as record_source, s.external_id as record_external_id, s.parsed -> 'facts' ->> 'name' as record_name,
             s.parsed -> 'facts' -> 'address' ->> 'raw' as record_address,
             s.entity_id as record_entity_id, re.canonical_name as record_entity_name,
             c.id as candidate_entity_id, c.canonical_name as candidate_name, c.rcs_number as candidate_rcs,
             c.registered_address ->> 'raw' as candidate_address
      from match_candidates m
      join source_records s on s.id = m.source_record_id
      join entities c on c.id = m.entity_id
      left join entities re on re.id = s.entity_id
      where m.decision = 'pending'
      order by m.score desc, m.id
      limit 200`)
  ).rows;
  return plain(rows);
}

// ------------------------------------------------------------------ jobs

/** Kind: async function. Job catalog + schedules + queue state + RCS number space. */
export async function jobsPage() {
  const [setting] = await engineDb.select().from(engineSettings).where(eq(engineSettings.key, DISABLED_SCHEDULES_KEY));
  const [counts, recent, schedules, space, sessions, runs] = await Promise.all([
    queueQuery<{ name: string; state: string; n: number }>(sql`select name, state, count(*)::int as n from pgboss.job group by 1, 2`),
    queueQuery<{ id: string; name: string; state: string; data: unknown; output: unknown; created_on: string; started_on: string | null; completed_on: string | null; retry_count: number }>(
      sql`select id, name, state, data, output, created_on, started_on, completed_on, retry_count from pgboss.job order by created_on desc limit 60`,
    ),
    queueQuery<{ name: string; cron: string; timezone: string | null }>(sql`select name, cron, timezone from pgboss.schedule`),
    engineDb.select().from(rcsNumberSpace).orderBy(rcsNumberSpace.prefix),
    engineDb.select().from(sessionHealth),
    engineDb.select().from(crawlRuns).orderBy(desc(crawlRuns.startedAt)).limit(20),
  ]);
  return plain({
    catalog: JOB_CATALOG,
    disabled: (setting?.value as string[] | undefined) ?? [],
    queueReady: counts !== null,
    counts: counts ?? [],
    recent: recent ?? [],
    schedules: schedules ?? [],
    space,
    sessions,
    runs,
  });
}
