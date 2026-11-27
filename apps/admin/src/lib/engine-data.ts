/**
 * FILE: apps/admin/src/lib/engine-data.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The read queries behind the "Company intelligence" pages: the pipeline overview (layer counts for
 *   the dataflow diagram, coverage per source, field completeness, quality, census, sessions, runs, change
 *   feed), sources (registry, review policies, precedence), the companies list with filters, one company with
 *   everything known about it (lineage, licences, filings, people, web & social, news, relations, history),
 *   the review queues (staging approval, matches, conflicts, rejects, mentions), data quality, and the jobs
 *   page. All read the Intelligence database (packages/engine-db), mostly through its `mart` views.
 *   Results are converted to plain JSON (dates → strings) before they are handed to client components.
 * WHERE IT RUNS: server only (server components call these).
 * TYPESCRIPT YOU WILL SEE HERE: `sql<…>` typed raw queries, `Promise.all`, a JSON round-trip for serialisation.
 */

import "server-only";
import { and, asc, count, desc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { db as engineDb } from "@fundhub/engine-db/client";
import { DISABLED_SCHEDULES_KEY, JOB_CATALOG } from "@fundhub/engine-db/jobs-catalog";
import { activeRound, listRounds, nextItems, roundItems, roundStats } from "@fundhub/engine-db/core/rounds";
import {
  activityCategories,
  articles,
  attributePrecedence,
  censusSnapshots,
  conflicts,
  fieldLineage,
  newsMentions,
  people,
  positions,
  reviewPolicies,
  sources as sourceRegistry,
  webPresence,
  changes,
  runs,
  licences,
  settings,
  companies,
  companyIdentifiers,
  companyNames,
  companyRelations,
  claims,
  filings,
  lbrNumberSpace,
  rowHistory,
  sessionHealth,
  sourceRecords,
  COMPANY_KINDS,
  COMPANY_STATUSES,
  ENGINE_SOURCES,
  companyGroups,
  companyGroupMembers,
  fundEvents,
  mandateEvidence,
  mandateRoles,
  mandates,
  FUND_LAWS,
  FUND_REGIMES,
  FUND_ROLES,
  GROUP_LAYERS,
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
  const [census, trend, sessions, recentRuns, events, space, queue] = await Promise.all([
    engineDb.select().from(censusSnapshots).where(sql`${censusSnapshots.takenOn} = (select max(taken_on) from ops.census_snapshots)`).orderBy(censusSnapshots.source, censusSnapshots.scope),
    engineDb
      .select({ day: censusSnapshots.takenOn, scope: censusSnapshots.scope, seen: censusSnapshots.seen })
      .from(censusSnapshots)
      .where(and(eq(censusSnapshots.source, "registry"), sql`${censusSnapshots.scope} in ('all', 'service_providers')`))
      .orderBy(desc(censusSnapshots.takenOn))
      .limit(60),
    engineDb.select().from(sessionHealth),
    engineDb.select().from(runs).orderBy(desc(runs.startedAt)).limit(15),
    engineDb
      .select({ id: changes.id, kind: changes.kind, source: changes.source, attribute: changes.attribute, newValue: changes.newValue, actor: changes.actor, detectedAt: changes.detectedAt, companyId: changes.companyId, entityName: companies.canonicalName })
      .from(changes)
      .leftJoin(companies, eq(companies.id, changes.companyId))
      .orderBy(desc(changes.id))
      .limit(30),
    engineDb.select().from(lbrNumberSpace).orderBy(lbrNumberSpace.prefix),
    queueQuery<{ name: string; state: string; n: number }>(sql`select name, state, count(*)::int as n from pgboss.job group by 1, 2 order by 1, 2`),
  ]);
  const [totals] = (
    await engineDb.execute<{ companies: number; service_providers: number; with_rcs: number; with_lei: number; pending_matches: number }>(sql`
      select (select count(*) from core.companies)::int as companies,
             (select count(*) from core.companies where is_service_provider)::int as service_providers,
             (select count(*) from core.companies where rcs_number is not null)::int as with_rcs,
             (select count(*) from core.companies where lei is not null)::int as with_lei,
             (select count(*) from match.candidates where decision = 'pending')::int as pending_matches`)
  ).rows;
  return plain({ census, trend, sessions, runs: recentRuns, events, space, queue, totals });
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
  /** Fund profile: UCITS / AIF, product law, role in a fund structure. */
  regime?: string;
  law?: string;
  role?: string;
  page?: string;
};

/** Kind: async function. One page of companies matching the filters, plus the total. */
export async function registryList(f: RegistryFilters) {
  const pageSize = 50;
  const page = Math.max(1, Number(f.page) || 1);
  const conds: SQL[] = [];
  if (f.q?.trim()) {
    const term = `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(
      or(
        ilike(companies.canonicalName, term),
        ilike(companies.rcsNumber, term),
        ilike(companies.lei, term),
        sql`exists (select 1 from core.company_identifiers i where i.company_id = companies.id and i.value ilike ${term})`,
        sql`exists (select 1 from core.company_names n where n.company_id = companies.id and n.name ilike ${term})`,
      )!,
    );
  }
  if (f.kind && (COMPANY_KINDS as readonly string[]).includes(f.kind)) conds.push(eq(companies.companyKind, f.kind as (typeof COMPANY_KINDS)[number]));
  if (f.sp === "yes") conds.push(eq(companies.isServiceProvider, true));
  if (f.sp === "no") conds.push(eq(companies.isServiceProvider, false));
  if (f.category && Number(f.category)) conds.push(or(eq(companies.activityCategoryId, Number(f.category)), eq(companies.activitySubcategoryId, Number(f.category)))!);
  if (f.status && (COMPANY_STATUSES as readonly string[]).includes(f.status)) conds.push(eq(companies.status, f.status as (typeof COMPANY_STATUSES)[number]));
  if (f.tier && /^[012]$/.test(f.tier)) conds.push(eq(companies.tier, Number(f.tier)));
  if (f.regime && (FUND_REGIMES as readonly string[]).includes(f.regime)) conds.push(eq(companies.fundRegime, f.regime as (typeof FUND_REGIMES)[number]));
  if (f.law && (FUND_LAWS as readonly string[]).includes(f.law)) conds.push(eq(companies.fundLaw, f.law as (typeof FUND_LAWS)[number]));
  if (f.role && (FUND_ROLES as readonly string[]).includes(f.role)) conds.push(eq(companies.fundRole, f.role as (typeof FUND_ROLES)[number]));
  if (f.rcs === "yes") conds.push(sql`${companies.rcsNumber} is not null`);
  if (f.rcs === "no") conds.push(isNull(companies.rcsNumber));
  if (f.source && (ENGINE_SOURCES as readonly string[]).includes(f.source)) {
    conds.push(sql`exists (select 1 from staging.source_records s where s.company_id = companies.id and s.source = ${f.source} and s.state = 'found')`);
  }
  const where = conds.length ? and(...conds) : undefined;
  // Correlated subqueries name the outer table explicitly (`companies.id`): an interpolated column would render
  // as a bare "id", which Postgres would resolve to the inner table's id.
  const cat = sql<string | null>`(select label from core.activity_categories c where c.id = companies.activity_category_id)`;
  const sub = sql<string | null>`(select label from core.activity_categories c where c.id = companies.activity_subcategory_id)`;
  const sources = sql<string[]>`(select coalesce(array_agg(distinct s.source order by s.source), '{}') from staging.source_records s where s.company_id = companies.id and s.state = 'found')`;
  const [rows, [{ n }]] = await Promise.all([
    engineDb
      .select({
        id: companies.id,
        name: companies.canonicalName,
        rcsNumber: companies.rcsNumber,
        lei: companies.lei,
        status: companies.status,
        kind: companies.companyKind,
        sp: companies.isServiceProvider,
        tier: companies.tier,
        fundRegime: companies.fundRegime,
        fundLaw: companies.fundLaw,
        fundRole: companies.fundRole,
        legalVehicle: companies.legalVehicle,
        category: cat,
        subcategory: sub,
        sources,
        lastChangedAt: companies.lastChangedAt,
      })
      .from(companies)
      .where(where)
      .orderBy(asc(companies.canonicalName))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
    engineDb.select({ n: count() }).from(companies).where(where),
  ]);
  return plain({ rows, total: n, page, pageSize });
}

/** Kind: async function. All activity categories (for filters and the edit form). */
export async function categoryOptions() {
  return plain(await engineDb.select({ id: activityCategories.id, slug: activityCategories.slug, label: activityCategories.label, parentId: activityCategories.parentId, level: activityCategories.level }).from(activityCategories).orderBy(activityCategories.level, activityCategories.sort));
}

// ------------------------------------------------------------------ one entity

/** Kind: async function. One company with everything known about it and its history (null if unknown id). */
export async function entityDetail(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [entity] = await engineDb.select().from(companies).where(eq(companies.id, id));
  if (!entity) return null;
  const [identifiers, names, records, open, history, relations, events, rows, lineage, openConflicts, team, presence, news] = await Promise.all([
    engineDb.select().from(companyIdentifiers).where(eq(companyIdentifiers.companyId, id)),
    engineDb.select().from(companyNames).where(eq(companyNames.companyId, id)).orderBy(desc(companyNames.validFrom)),
    engineDb
      .select({ id: sourceRecords.id, source: sourceRecords.source, externalId: sourceRecords.externalId, state: sourceRecords.state, scope: sourceRecords.scope, lastSeenAt: sourceRecords.lastSeenAt, lastChangedAt: sourceRecords.lastChangedAt, nextFetchAt: sourceRecords.nextFetchAt, lastError: sourceRecords.lastError })
      .from(sourceRecords)
      .where(eq(sourceRecords.companyId, id)),
    engineDb.select({ source: claims.source, attribute: claims.attribute, value: claims.value, validFrom: claims.validFrom }).from(claims).where(and(eq(claims.companyId, id), isNull(claims.validTo))),
    engineDb
      .select({ id: claims.id, source: claims.source, attribute: claims.attribute, value: claims.value, validFrom: claims.validFrom, validTo: claims.validTo })
      .from(claims)
      .where(eq(claims.companyId, id))
      .orderBy(desc(claims.validFrom), desc(claims.id))
      .limit(300),
    engineDb.select().from(companyRelations).where(eq(companyRelations.subjectCompanyId, id)).orderBy(isNull(companyRelations.validTo), companyRelations.objectName),
    engineDb.select().from(changes).where(eq(changes.companyId, id)).orderBy(desc(changes.id)).limit(200),
    engineDb.select().from(rowHistory).where(and(eq(rowHistory.tableName, "core.companies"), eq(rowHistory.rowId, id))).orderBy(desc(rowHistory.id)).limit(50),
    engineDb.select().from(fieldLineage).where(eq(fieldLineage.companyId, id)),
    engineDb.select().from(conflicts).where(eq(conflicts.companyId, id)).orderBy(desc(conflicts.updatedAt)),
    engineDb
      .select({ id: positions.id, name: people.fullName, profileUrl: people.profileUrl, title: positions.title, role: positions.role, source: positions.source, evidenceUrl: positions.evidenceUrl, validFrom: positions.validFrom, validTo: positions.validTo })
      .from(positions)
      .innerJoin(people, eq(people.id, positions.personId))
      .where(eq(positions.companyId, id))
      .orderBy(isNull(positions.validTo), positions.role, people.fullName),
    engineDb.select().from(webPresence).where(eq(webPresence.companyId, id)).orderBy(webPresence.platform),
    engineDb
      .select({ id: newsMentions.id, confidence: newsMentions.confidence, decision: newsMentions.decision, title: articles.title, url: articles.url, publishedAt: articles.publishedAt, author: articles.author, snippet: articles.snippet })
      .from(newsMentions)
      .innerJoin(articles, eq(articles.id, newsMentions.articleId))
      .where(eq(newsMentions.companyId, id))
      .orderBy(desc(articles.publishedAt))
      .limit(100),
  ]);
  const recordIds = records.map((r) => r.id);
  const [details, filingRows, clientOf] = await Promise.all([
    recordIds.length ? engineDb.select().from(licences).where(sql`${licences.sourceRecordId} in ${recordIds}`).orderBy(licences.kind, licences.code) : [],
    recordIds.length ? engineDb.select().from(filings).where(sql`${filings.sourceRecordId} in ${recordIds}`).orderBy(desc(filings.filingDate)).limit(300) : [],
    engineDb
      .select({ id: companyRelations.id, kind: companyRelations.kind, providerId: companyRelations.subjectCompanyId, providerName: companies.canonicalName, validTo: companyRelations.validTo })
      .from(companyRelations)
      .innerJoin(companies, eq(companies.id, companyRelations.subjectCompanyId))
      .where(eq(companyRelations.objectCompanyId, id)),
  ]);
  const groups = (
    await engineDb.execute<{ id: number; name: string; layer: string; kind: string; path: string; role: string; source: string; confidence: number; evidence: string | null; valid_to: string | null }>(sql`
      select g.id, g.name, g.layer, g.kind, coalesce(t.path, g.name) as path, m.role, m.source, m.confidence, m.evidence, m.valid_to
      from core.company_group_members m join core.company_groups g on g.id = m.group_id left join mart.group_tree t on t.id = g.id
      where m.company_id = ${id} order by m.valid_to nulls first, g.layer, g.name`)
  ).rows;
  // Service mandates: who serves this fund (all episodes), and whom this company serves (current, as provider).
  const [served, serving, lifecycle, roles] = await Promise.all([
    engineDb
      .select({
        id: mandates.id, role: mandates.role, providerCompanyId: mandates.providerCompanyId, providerName: mandates.providerName, providerLei: mandates.providerLei,
        validFrom: mandates.validFrom, validFromPrecision: mandates.validFromPrecision, validTo: mandates.validTo, validToPrecision: mandates.validToPrecision,
        status: mandates.status, decidedBy: mandates.decidedBy, confidence: mandates.confidence, lastSeenAt: mandates.lastSeenAt,
        evidence: sql<string | null>`(select string_agg(coalesce(e.quote, e.source) || coalesce(' (' || e.document_date || ')', ''), ' · ') from core.mandate_evidence e where e.mandate_id = "mandates"."id")`, // named explicitly: an interpolated column renders bare ("id") = the inner table's
      })
      .from(mandates)
      .where(eq(mandates.clientCompanyId, id))
      .orderBy(mandates.role, desc(sql`coalesce(${mandates.validFrom}, '0001-01-01')`)),
    engineDb
      .select({ id: mandates.id, role: mandates.role, clientId: mandates.clientCompanyId, client: companies.canonicalName, fundRole: companies.fundRole, validFrom: mandates.validFrom, validFromPrecision: mandates.validFromPrecision, decidedBy: mandates.decidedBy })
      .from(mandates)
      .innerJoin(companies, eq(companies.id, mandates.clientCompanyId))
      .where(and(eq(mandates.providerCompanyId, id), eq(mandates.status, "current")))
      .orderBy(desc(sql`coalesce(${mandates.validFrom}, '0001-01-01')`))
      .limit(1000),
    engineDb
      .select({ id: fundEvents.id, kind: fundEvents.kind, eventDate: fundEvents.eventDate, datePrecision: fundEvents.datePrecision, relatedCompanyId: fundEvents.relatedCompanyId, source: fundEvents.source, evidence: fundEvents.evidence,
        related: sql<string | null>`(select r.canonical_name from core.companies r where r.id = "fund_events"."related_company_id")` })
      .from(fundEvents)
      .where(eq(fundEvents.companyId, id))
      .orderBy(desc(sql`coalesce(${fundEvents.eventDate}, '9999-12-31')`))
      .limit(500),
    engineDb.select().from(mandateRoles).orderBy(mandateRoles.sort),
  ]);
  void mandateEvidence;
  // Which source "won" each golden attribute: recorded by the consolidate stage (core.field_lineage).
  const winners = Object.fromEntries(lineage.map((l) => [l.attribute, l.source]));
  return plain({ entity, identifiers, names, records, open, history, relations, events, rowHistory: rows, details, filings: filingRows, clientOf, winners, lineage, conflicts: openConflicts, team, presence, news, groups, served, serving, lifecycle, roles });
}

/** Kind: async function. Companies whose name matches (for linking a client to a company). */
export async function searchEntities(q: string) {
  if (q.trim().length < 2) return [];
  return plain(await engineDb.select({ id: companies.id, name: companies.canonicalName, rcsNumber: companies.rcsNumber }).from(companies).where(ilike(companies.canonicalName, `%${q.trim()}%`)).limit(20));
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
             s.source as record_source, s.external_id as record_external_id, s.released -> 'facts' ->> 'name' as record_name,
             s.released -> 'facts' -> 'address' ->> 'raw' as record_address,
             s.company_id as record_entity_id, re.canonical_name as record_entity_name,
             c.id as candidate_entity_id, c.canonical_name as candidate_name, c.rcs_number as candidate_rcs,
             c.registered_address ->> 'raw' as candidate_address
      from match.candidates m
      join staging.source_records s on s.id = m.source_record_id
      join core.companies c on c.id = m.company_id
      left join core.companies re on re.id = s.company_id
      where m.decision = 'pending'
      order by m.score desc, m.id
      limit 200`)
  ).rows;
  return plain(rows);
}

// ------------------------------------------------------------------ jobs

/** Kind: async function. Job catalog + schedules + queue state + RCS number space. */
export async function jobsPage() {
  const [setting] = await engineDb.select().from(settings).where(eq(settings.key, DISABLED_SCHEDULES_KEY));
  const [counts, recent, schedules, space, sessions, recentRuns] = await Promise.all([
    queueQuery<{ name: string; state: string; n: number }>(sql`select name, state, count(*)::int as n from pgboss.job group by 1, 2`),
    queueQuery<{ id: string; name: string; state: string; data: unknown; output: unknown; created_on: string; started_on: string | null; completed_on: string | null; retry_count: number }>(
      sql`select id, name, state, data, output, created_on, started_on, completed_on, retry_count from pgboss.job order by created_on desc limit 60`,
    ),
    queueQuery<{ name: string; cron: string; timezone: string | null }>(sql`select name, cron, timezone from pgboss.schedule`),
    engineDb.select().from(lbrNumberSpace).orderBy(lbrNumberSpace.prefix),
    engineDb.select().from(sessionHealth),
    engineDb.select().from(runs).orderBy(desc(runs.startedAt)).limit(20),
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
    runs: recentRuns,
  });
}

// ------------------------------------------------------------------ capture rounds (register)

/** Kind: async function. The register of capture rounds (newest first) with totals, plus one round's items. */
export async function roundsPage(roundId?: number, status?: string) {
  const rounds = await listRounds(engineDb);
  const selected = roundId ? rounds.find((r) => r.id === roundId) : (rounds.find((r) => r.status === "active") ?? rounds[0]);
  const items = selected ? await roundItems(selected.id, { status: status || undefined, limit: 500 }, engineDb) : [];
  return plain({ rounds, selectedId: selected?.id ?? null, items });
}

/** Kind: async function. The active round and its totals (dashboard card), or null. */
export async function currentRound() {
  const r = await activeRound(engineDb);
  if (!r) return null;
  return plain({ ...r, stats: await roundStats(r.id, engineDb), next: await nextItems(3, engineDb) });
}

// ------------------------------------------------------------------ pipeline overview (dataflow diagram)

/** Kind: async function. Everything the Pipeline page shows: layer counts, per-source coverage, quality. */
export async function pipelineOverview() {
  const [counts, coverage, completeness, quality, dashboard] = await Promise.all([
    engineDb.execute<{ layer: string; metric: string; value: number }>(sql`select layer, metric, value::int as value from mart.pipeline_counts`),
    engineDb.execute<{ source: string; system: string; name: string; kind: string; enabled: boolean; records: number; found: number; gone: number; linked: number; pending_review: number; last_seen_at: string | null; last_run_at: string | null }>(
      sql`select source, system, name, kind, enabled, records::int, found::int, gone::int, linked::int, pending_review::int, last_seen_at, last_run_at from mart.coverage_by_source`,
    ),
    engineDb.execute<{ attribute: string; filled: number; total: number; ratio: number }>(sql`select attribute, filled::int, total::int, ratio from mart.field_completeness`),
    latestQuality(),
    engineDashboard(),
  ]);
  const metrics: Record<string, number> = {};
  for (const r of counts.rows) metrics[`${r.layer}.${r.metric}`] = r.value;
  return plain({ metrics, coverage: coverage.rows, completeness: completeness.rows, quality, dashboard });
}

/** Kind: async function. The latest result of every quality check. */
async function latestQuality() {
  return (
    await engineDb.execute<{ code: string; label: string; description: string; layer: string; min: number | null; max: number | null; value: number | null; numerator: number | null; denominator: number | null; passed: boolean | null; measured_at: string | null }>(sql`
      select q.code, q.label, q.description, q.layer, q.min, q.max, r.value, r.numerator, r.denominator, r.passed, r.measured_at
      from ops.quality_checks q
      left join lateral (select * from ops.quality_results x where x.check_code = q.code order by x.measured_at desc limit 1) r on true
      where q.enabled order by q.sort`)
  ).rows;
}

// ------------------------------------------------------------------ sources

/** Kind: async function. The source registry with coverage, review policies and attribute precedence. */
export async function sourcesPage() {
  const [registry, coverage, policies, precedence, feeds] = await Promise.all([
    engineDb.select().from(sourceRegistry).orderBy(sourceRegistry.sort),
    engineDb.execute<{ source: string; records: number; found: number; linked: number; pending_review: number; last_run_at: string | null }>(sql`select source, records::int, found::int, linked::int, pending_review::int, last_run_at from mart.coverage_by_source`),
    engineDb.select().from(reviewPolicies).orderBy(reviewPolicies.source, reviewPolicies.scope),
    engineDb.select().from(attributePrecedence).orderBy(attributePrecedence.attribute, attributePrecedence.rank),
    engineDb.execute<{ id: number; name: string; url: string; enabled: boolean; last_polled_at: string | null; last_error: string | null; articles: number }>(sql`select id, name, url, enabled, last_polled_at, last_error, articles from ops.news_feeds order by name`),
  ]);
  return plain({ registry, coverage: coverage.rows, policies, precedence, feeds: feeds.rows });
}

// ------------------------------------------------------------------ review queues

/** Kind: async function. Versions waiting at the staging approval gate (newest first), with the previous released version. */
export async function stagingQueue(f: { source?: string } = {}) {
  const rows = (
    await engineDb.execute<{
      id: number; source: string; external_id: string; scope: string | null; company_id: string | null; company_name: string | null;
      reasons: string[] | null; payload: Record<string, unknown>; released: Record<string, unknown> | null; created_at: string; fetch_url: string | null; parser_version: number;
    }>(sql`
      select p.id, r.source, r.external_id, r.scope, r.company_id, c.canonical_name as company_name, p.review_reasons as reasons,
             p.payload, r.released, p.created_at, f.url as fetch_url, p.parser_version
      from staging.parsed_records p
      join staging.source_records r on r.id = p.source_record_id
      left join core.companies c on c.id = r.company_id
      left join raw.fetches f on f.id = p.fetch_id
      where p.review_status = 'pending' ${f.source && (ENGINE_SOURCES as readonly string[]).includes(f.source) ? sql`and r.source = ${f.source}` : sql``}
      order by p.created_at desc limit 200`)
  ).rows;
  return plain(rows);
}

/** Kind: async function. All review queues at once (counts + rows) for the Review page. */
export async function reviewPage(f: { source?: string } = {}) {
  const [staging, matches, conflictRows, rejects, mentions] = await Promise.all([
    stagingQueue(f),
    pendingMatches(),
    engineDb.execute<{ id: number; company_id: string; company_name: string; attribute: string; values: { source: string; value: unknown }[]; winner: string | null; status: string; detected_at: string; updated_at: string }>(sql`
      select x.id, x.company_id, c.canonical_name as company_name, x.attribute, x.values, x.winner, x.status, x.detected_at, x.updated_at
      from match.conflicts x join core.companies c on c.id = x.company_id
      where x.status = 'open' order by x.updated_at desc limit 300`),
    engineDb.execute<{ id: number; source: string; external_id: string; company_id: string | null; attribute: string; value: unknown; reason: string; created_at: string }>(sql`
      select j.id, j.source, r.external_id, r.company_id, j.attribute, j.value, j.reason, j.created_at
      from clean.rejects j join staging.source_records r on r.id = j.source_record_id
      order by j.created_at desc limit 300`),
    engineDb.execute<{ id: number; confidence: number; matched_text: string; company_id: string; company_name: string; title: string; url: string; snippet: string | null; published_at: string | null }>(sql`
      select m.id, m.confidence, m.matched_text, m.company_id, c.canonical_name as company_name, a.title, a.url, a.snippet, a.published_at
      from core.news_mentions m join core.companies c on c.id = m.company_id join clean.articles a on a.id = m.article_id
      where m.decision = 'pending' order by a.published_at desc nulls last limit 300`),
  ]);
  return plain({ staging, matches, conflicts: conflictRows.rows, rejects: rejects.rows, mentions: mentions.rows });
}

// ------------------------------------------------------------------ data quality

/** Kind: async function. Latest value of each check, its history (90 days) and field completeness. */
export async function qualityPage() {
  const [latest, history, completeness] = await Promise.all([
    latestQuality(),
    engineDb.execute<{ code: string; day: string; value: number }>(sql`
      select check_code as code, to_char(date_trunc('day', measured_at), 'YYYY-MM-DD') as day, avg(value)::real as value
      from ops.quality_results where measured_at > now() - interval '90 days' and scope = 'all' group by 1, 2 order by 2`),
    engineDb.execute<{ attribute: string; filled: number; total: number; ratio: number }>(sql`select attribute, filled::int, total::int, ratio from mart.field_completeness`),
  ]);
  return plain({ latest, history: history.rows, completeness: completeness.rows });
}

// ------------------------------------------------------------------ company groups

/** Kind: type alias. Filters of the groups page. */
export type GroupFilters = { layer?: string; q?: string; source?: string };

/**
 * Kind: async function. Groups of one layer as a tree: the top-level groups matching the search, with their
 * descendants (from mart.group_tree), and per-layer / per-kind counts for the tabs.
 */
export async function groupsPage(f: GroupFilters) {
  const layer = (GROUP_LAYERS as readonly string[]).includes(f.layer ?? "") ? f.layer! : "corporate";
  const q = f.q?.trim() ? `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const source = f.source && ["gleif", "cssf", "name_rule", "manual"].includes(f.source) ? f.source : null;
  const [counts, rows] = await Promise.all([
    engineDb.execute<{ layer: string; kind: string; groups: number; members: number }>(sql`
      select layer, kind, count(*)::int as groups, coalesce(sum(member_count), 0)::int as members from core.company_groups group by 1, 2 order by 1, 2`),
    // A tab shows one layer as its own tree: a group whose parent is in another layer (a fund platform under a
    // corporate group, a provider group under its corporate group) is a top-level entry here. Top-level groups
    // (largest first) that match, or contain a descendant that matches; then their whole subtree in this layer.
    engineDb.execute<{ id: number; parent_group_id: number | null; name: string; kind: string; source: string; member_count: number; depth: number; root_id: number; head_company_id: string | null }>(sql`
      with recursive base as (
        select g.id, g.parent_group_id, g.name, g.kind, g.source, g.member_count, g.head_company_id, p.layer as parent_layer
        from core.company_groups g left join core.company_groups p on p.id = g.parent_group_id
        where g.layer = ${layer}
      ), t as (
        select b.id, b.parent_group_id, b.name, b.kind, b.source, b.member_count, b.head_company_id, 1 as depth, b.id as root_id
        from base b where b.parent_group_id is null or b.parent_layer is distinct from ${layer}
        union all
        select b.id, b.parent_group_id, b.name, b.kind, b.source, b.member_count, b.head_company_id, t.depth + 1, t.root_id
        from base b join t on b.parent_group_id = t.id and b.parent_layer = ${layer}
        where t.depth < 10
      ), roots as (
        select distinct t.root_id from t
        where (${q}::text is null or t.name ilike ${q} or exists (
                select 1 from core.company_group_members m join core.companies c on c.id = m.company_id
                where m.group_id = t.id and m.valid_to is null and c.canonical_name ilike ${q}))
          and (${source}::text is null or t.source = ${source})
      ), top as (
        select r.root_id from roots r join core.company_groups g on g.id = r.root_id
        order by g.member_count desc, g.name limit 200
      )
      select t.id, t.parent_group_id, t.name, t.kind, t.source, t.member_count, t.depth, t.root_id, t.head_company_id
      from t where t.root_id in (select root_id from top)
      order by t.depth, t.member_count desc, t.name`),
  ]);
  return plain({ layer, counts: counts.rows, groups: rows.rows });
}

/** Kind: async function. One group: itself, its path, parent and children, and its members (current first). */
export async function groupDetail(id: number) {
  if (!Number.isInteger(id) || id <= 0) return null;
  const [group] = await engineDb.select().from(companyGroups).where(eq(companyGroups.id, id));
  if (!group) return null;
  const [path, children, members, parentOptions] = await Promise.all([
    engineDb.execute<{ path: string; depth: number }>(sql`select path, depth from mart.group_tree where id = ${id}`),
    engineDb.select({ id: companyGroups.id, name: companyGroups.name, kind: companyGroups.kind, memberCount: companyGroups.memberCount, source: companyGroups.source }).from(companyGroups).where(eq(companyGroups.parentGroupId, id)).orderBy(desc(companyGroups.memberCount)).limit(500),
    engineDb
      .select({
        id: companyGroupMembers.id, companyId: companyGroupMembers.companyId, role: companyGroupMembers.role, source: companyGroupMembers.source, confidence: companyGroupMembers.confidence,
        evidence: companyGroupMembers.evidence, validFrom: companyGroupMembers.validFrom, validTo: companyGroupMembers.validTo,
        name: companies.canonicalName, kind: companies.companyKind, fundRegime: companies.fundRegime, fundLaw: companies.fundLaw, fundRole: companies.fundRole, rcsNumber: companies.rcsNumber, lei: companies.lei, sp: companies.isServiceProvider,
      })
      .from(companyGroupMembers)
      .innerJoin(companies, eq(companies.id, companyGroupMembers.companyId))
      .where(eq(companyGroupMembers.groupId, id))
      .orderBy(sql`${companyGroupMembers.validTo} is not null`, sql`case ${companyGroupMembers.role} when 'head' then 0 when 'umbrella_fund' then 0 when 'master_fund' then 0 else 1 end`, companies.canonicalName)
      .limit(2000),
    group.parentGroupId ? engineDb.select({ id: companyGroups.id, name: companyGroups.name, kind: companyGroups.kind, layer: companyGroups.layer }).from(companyGroups).where(eq(companyGroups.id, group.parentGroupId)) : [],
  ]);
  return plain({ group, path: path.rows[0]?.path ?? group.name, depth: path.rows[0]?.depth ?? 1, children, members, parent: parentOptions[0] ?? null });
}

/** Kind: async function. Groups whose name matches (to pick a parent or a group to add a company to). */
export async function searchGroups(q: string) {
  const term = q.trim();
  if (term.length < 2) return [];
  return plain(
    await engineDb
      .select({ id: companyGroups.id, name: companyGroups.name, layer: companyGroups.layer, kind: companyGroups.kind, memberCount: companyGroups.memberCount })
      .from(companyGroups)
      .where(ilike(companyGroups.name, `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`))
      .orderBy(desc(companyGroups.memberCount))
      .limit(20),
  );
}
