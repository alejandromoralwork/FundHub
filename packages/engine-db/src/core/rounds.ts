/**
 * FILE: packages/engine-db/src/core/rounds.ts
 * PART: shared package (packages/engine-db) — capture rounds, used by the capture receiver, the CLI and the admin
 * WHAT IT DOES: Capture ROUNDS ("loops") — the plan and register of passes over RCS companies that a person works
 *   through with the FundHub LBR Capture extension:
 *   - initial round: companies known (GLEIF / CSSF / imports) but never captured from the RCS;
 *   - update round (e.g. monthly): companies already captured, most-likely-changed first — unchanged pages cost
 *     nothing (content hash) and only new filings' PDFs are fetched.
 *   Functions: start / close a round, next items, record a visit or a document, skip, reset skipped
 *   ("clean the cycle"), stats and the register of all rounds. One round is active at a time.
 * WHERE IT RUNS: on Node.js — engine (capture-server, CLI) and admin console server actions.
 * TYPESCRIPT YOU WILL SEE HERE: `sql` templates with conditional fragments, `insert … select`.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db, type EngineTx } from "../client";
import { captureRoundItems, captureRounds, type RoundScope } from "../schema";

/** Kind: type alias. One company as shown in the extension / admin. */
export type RoundItemView = {
  rcs: string;
  name: string | null;
  kind: string | null;
  serviceProvider: boolean;
  category: string | null;
  status: string | null;
  itemStatus: string;
  position: number;
};

/** Kind: function. The SQL condition for a scope (on entities `e` and identifier `i`). */
function scopeWhere(scope: RoundScope) {
  const f = scope.filter;
  if (f === "sp") return sql`and e.is_service_provider`;
  if (f === "am") return sql`and e.entity_kind = 'asset_manager'`;
  if (f === "text" && scope.text?.trim()) {
    const t = scope.text.trim();
    return sql`and (e.canonical_name ilike ${"%" + t + "%"} or i.value ilike ${t + "%"})`;
  }
  return sql``;
}

/** Kind: async function. The active round, or null. */
export async function activeRound(tx: EngineTx = db) {
  const [r] = await tx.select().from(captureRounds).where(eq(captureRounds.status, "active"));
  return r ?? null;
}

/**
 * Kind: async function. Closes any active round, then creates a new one and snapshots its companies.
 * @returns `{ round, items }` — the new round and how many companies it holds.
 */
export async function startRound(opts: { kind: "initial" | "update"; scope: RoundScope; name?: string; actor?: string; notes?: string }, tx: EngineTx = db) {
  await closeRound(tx);
  const name = opts.name?.trim() || `${new Date().toISOString().slice(0, 7)} ${opts.kind}${opts.scope.filter !== "all" ? ` (${opts.scope.filter === "text" ? opts.scope.text : opts.scope.filter})` : ""}`;
  const [round] = await tx.insert(captureRounds).values({ name, kind: opts.kind, scope: opts.scope, createdBy: opts.actor ?? null, notes: opts.notes ?? null }).returning();
  const where = scopeWhere(opts.scope);

  if (opts.kind === "initial") {
    // Known RCS numbers never captured from the RCS, most important first.
    await tx.execute(sql`
      insert into capture_round_items (round_id, rcs, position)
      select ${round.id}, rcs, row_number() over (order by tier desc, sp desc, am desc, rcs)
      from (
        select distinct on (i.value) i.value as rcs, e.tier, e.is_service_provider as sp, (e.entity_kind = 'asset_manager') as am
        from entity_identifiers i join entities e on e.id = i.entity_id
        where i.scheme = 'rcs' and i.value !~ '^A'
          and not exists (select 1 from source_records s where s.source = 'rcs' and s.external_id = i.value and s.state in ('found', 'not_found'))
          ${where}
        order by i.value
      ) q`);
  } else {
    // Companies already captured. Most likely to have changed first: another source changed since the last RCS
    // capture, then recent filers, then tier / service providers.
    const skipDays = opts.scope.skipCapturedWithinDays ?? 0;
    await tx.execute(sql`
      insert into capture_round_items (round_id, rcs, position, filings_before)
      select ${round.id}, rcs, row_number() over (order by other_changed desc, last_filing desc nulls last, tier desc, sp desc, rcs), filings
      from (
        select s.external_id as rcs, e.tier, e.is_service_provider as sp,
               exists (select 1 from change_events c where c.entity_id = e.id and c.source in ('cssf', 'gleif') and c.detected_at > s.last_changed_at) as other_changed,
               (s.parsed -> 'facts' ->> 'rcsLastFilingDate') as last_filing,
               (select count(*) from rcs_filings f where f.source_record_id = s.id)::int as filings
        from source_records s
        join entities e on e.id = s.entity_id
        join entity_identifiers i on i.entity_id = e.id and i.scheme = 'rcs' and i.value = s.external_id
        where s.source = 'rcs' and s.state = 'found'
          and (${skipDays} = 0 or s.last_seen_at < now() - (${skipDays} || ' days')::interval)
          ${where}
      ) q`);
  }
  const [{ n }] = (await tx.execute<{ n: number }>(sql`select count(*)::int as n from capture_round_items where round_id = ${round.id}`)).rows;
  return { round, items: n };
}

/** Kind: async function. Closes the active round (pending items stay recorded as not visited). */
export async function closeRound(tx: EngineTx = db) {
  const r = await activeRound(tx);
  if (!r) return null;
  await tx.update(captureRounds).set({ status: "closed", closedAt: new Date() }).where(eq(captureRounds.id, r.id));
  return r;
}

/** Kind: async function. "Clean the cycle": puts skipped / failed items of the active round back to pending. */
export async function resetSkipped(tx: EngineTx = db) {
  const r = await activeRound(tx);
  if (!r) return 0;
  const res = await tx.execute(sql`update capture_round_items set status = 'pending', error = null where round_id = ${r.id} and status in ('skipped', 'failed')`);
  return res.rowCount ?? 0;
}

/** Kind: async function. The next pending companies of the active round (with names and tags). */
export async function nextItems(n = 10, tx: EngineTx = db): Promise<RoundItemView[]> {
  const r = await activeRound(tx);
  if (!r) return [];
  const rows = (
    await tx.execute<{ rcs: string; name: string | null; kind: string | null; sp: boolean | null; category: string | null; status: string | null; item_status: string; position: number }>(sql`
      select it.rcs, it.status as item_status, it.position, e.canonical_name as name, e.entity_kind as kind, e.is_service_provider as sp, e.status,
             (select label from activity_categories c where c.id = e.activity_category_id) as category
      from capture_round_items it
      left join entity_identifiers i on i.scheme = 'rcs' and i.value = it.rcs
      left join entities e on e.id = i.entity_id
      where it.round_id = ${r.id} and it.status = 'pending'
      order by it.position
      limit ${n}`)
  ).rows;
  return rows.map((x) => ({ rcs: x.rcs, name: x.name, kind: x.kind, serviceProvider: !!x.sp, category: x.category, status: x.status, itemStatus: x.item_status, position: x.position }));
}

/** Kind: async function. Marks a company of the active round as skipped (kept; "Reset skipped" brings it back). */
export async function skipItem(rcs: string, tx: EngineTx = db) {
  const r = await activeRound(tx);
  if (!r) return false;
  const res = await tx.execute(sql`update capture_round_items set status = 'skipped', visited_at = now() where round_id = ${r.id} and rcs = ${rcs} and status = 'pending'`);
  return (res.rowCount ?? 0) > 0;
}

/**
 * Kind: async function. Records the visit of a company in the active round (no-op if it is not in the round).
 * @param result  the ingest status ("new" | "changed" | "unchanged" | "not_found" | "gone"), filings now, new filings.
 */
export async function recordVisit(rcs: string, result: { status: string; filingsAfter?: number | null; newFilings?: number; error?: string }, tx: EngineTx = db) {
  const r = await activeRound(tx);
  if (!r) return null;
  const status = result.error ? "failed" : result.status === "new" ? "captured" : result.status === "changed" ? "changed" : result.status === "unchanged" ? "unchanged" : "not_found";
  await tx
    .update(captureRoundItems)
    .set({ status, visitedAt: new Date(), filingsAfter: result.filingsAfter ?? null, newFilings: sql`${captureRoundItems.newFilings} + ${result.newFilings ?? 0}`, error: result.error ?? null })
    .where(and(eq(captureRoundItems.roundId, r.id), eq(captureRoundItems.rcs, rcs)));
  return r;
}

/** Kind: async function. Counts a document saved for a company of the active round. */
export async function recordDocument(rcs: string, tx: EngineTx = db) {
  const r = await activeRound(tx);
  if (!r) return;
  await tx.execute(sql`update capture_round_items set new_documents = new_documents + 1 where round_id = ${r.id} and rcs = ${rcs}`);
}

/** Kind: type alias. Totals of a round. */
export type RoundStats = {
  total: number;
  done: number;
  pending: number;
  captured: number;
  changed: number;
  unchanged: number;
  not_found: number;
  skipped: number;
  failed: number;
  new_filings: number;
  new_documents: number;
  last_visit: string | null;
};

/** Kind: async function. Totals of one round. */
export async function roundStats(roundId: number, tx: EngineTx = db): Promise<RoundStats> {
  const [s] = (
    await tx.execute<RoundStats>(sql`
      select count(*)::int as total,
             count(*) filter (where status <> 'pending')::int as done,
             count(*) filter (where status = 'pending')::int as pending,
             count(*) filter (where status = 'captured')::int as captured,
             count(*) filter (where status = 'changed')::int as changed,
             count(*) filter (where status = 'unchanged')::int as unchanged,
             count(*) filter (where status = 'not_found')::int as not_found,
             count(*) filter (where status = 'skipped')::int as skipped,
             count(*) filter (where status = 'failed')::int as failed,
             coalesce(sum(new_filings), 0)::int as new_filings,
             coalesce(sum(new_documents), 0)::int as new_documents,
             max(visited_at) as last_visit
      from capture_round_items where round_id = ${roundId}`)
  ).rows;
  return s;
}

/** Kind: async function. The register: every round with its totals, newest first. */
export async function listRounds(tx: EngineTx = db) {
  const rounds = await tx.select().from(captureRounds).orderBy(desc(captureRounds.startedAt));
  return Promise.all(rounds.map(async (r) => ({ ...r, stats: await roundStats(r.id, tx) })));
}

/** Kind: async function. The items of one round (for the register detail), with entity names. */
export async function roundItems(roundId: number, opts: { status?: string; limit?: number } = {}, tx: EngineTx = db) {
  return (
    await tx.execute<{ rcs: string; position: number; status: string; visited_at: string | null; filings_before: number | null; filings_after: number | null; new_filings: number; new_documents: number; error: string | null; entity_id: string | null; name: string | null }>(sql`
      select it.*, e.id as entity_id, e.canonical_name as name
      from capture_round_items it
      left join entity_identifiers i on i.scheme = 'rcs' and i.value = it.rcs
      left join entities e on e.id = i.entity_id
      where it.round_id = ${roundId} ${opts.status ? sql`and it.status = ${opts.status}` : sql``}
      order by (it.status = 'pending'), it.visited_at desc nulls last, it.position
      limit ${opts.limit ?? 500}`)
  ).rows;
}
