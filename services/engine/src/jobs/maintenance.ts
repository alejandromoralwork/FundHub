/**
 * FILE: services/engine/src/jobs/maintenance.ts
 * PART: scraping engine (services/engine) — jobs that are not tied to one source
 *   reclassify {}       — re-applies classification rules to every entity (after editing rules), then links
 *                         clients (core.company_relations) to companies that appeared since they were recorded.
 *   census_snapshot {}  — writes today's registry-wide census (totals by kind, service providers, coverage).
 *   cssf_refresh {}     — queues `cssf_fetch` for CSSF records whose refresh date has passed.
 * WHERE IT RUNS: queue "maintenance" workers, or inline from the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: keyset pagination (`where id > last order by id limit n`).
 */

import { and, asc, eq, gt, lte, sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { companies, sourceRecords } from "@fundhub/engine-db/schema";
import { clearRulesCache, linkRelations, recomputeCompany } from "@fundhub/engine-db/core/entity";
import { snapshotRegistry } from "../core/ops";
import { snapshotRcsKnown } from "./rcs-list";
import { log } from "../log";
import { buildGroups } from "../pipeline/groups";
import { fundLifecycle } from "../pipeline/lifecycle";
import { domiciliationMatch } from "../pipeline/domiciliation";
import type { JobContext } from "./context";

/** Kind: async function. Job "reclassify". */
export async function reclassify(data: { all?: boolean } = {}) {
  clearRulesCache();
  let last = "00000000-0000-0000-0000-000000000000";
  let done = 0;
  // Struck-off companies are skipped (faster): their classification no longer matters. --all includes them.
  const alive = data.all ? sql`true` : sql`${companies.status} <> 'struck_off'`;
  for (;;) {
    const page = await db.select({ id: companies.id }).from(companies).where(and(gt(companies.id, last), alive)).orderBy(asc(companies.id)).limit(500);
    if (!page.length) break;
    for (const e of page) await db.transaction((tx) => recomputeCompany(tx, e.id));
    done += page.length;
    last = page[page.length - 1].id;
    log.info("reclassify", { done });
  }
  // Clients named before their own entity existed can be linked now.
  const linkedRelations = await linkRelations();
  return { companies: done, linkedRelations };
}

/** Kind: async function. Job "census_snapshot". */
export async function censusSnapshot() {
  await snapshotRcsKnown();
  const rows = await snapshotRegistry();
  return Object.fromEntries(rows.map((r) => [r.scope, r.seen]));
}

/** Kind: async function. Job "cssf_refresh". */
export async function cssfRefresh(data: { limit?: number }, ctx: JobContext) {
  const due = await db
    .select({ id: sourceRecords.externalId })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.source, "cssf"), eq(sourceRecords.state, "found"), lte(sourceRecords.nextFetchAt, new Date())))
    .limit(data.limit ?? 1000);
  for (const d of due) await ctx.enqueue("cssf_fetch", { id: d.id }, { singletonKey: `cssf:${d.id}` });
  return { queued: due.length };
}

/** Kind: async function. Job "build_groups" (see pipeline/groups.ts). */
export async function buildGroupsJob(data: { skipGleif?: boolean }, ctx: JobContext) {
  return buildGroups({ http: ctx.http, gleifApiBase: ctx.cfg.gleif.apiBase, gleifDelayMs: ctx.cfg.gleif.delayMs, skipGleif: !!data.skipGleif });
}

/** Kind: async function. Job "fund_lifecycle" (see pipeline/lifecycle.ts). */
export async function fundLifecycleJob() {
  return fundLifecycle();
}

/** Kind: async function. Job "domiciliation_match" (see pipeline/domiciliation.ts). */
export async function domiciliationJob() {
  return domiciliationMatch();
}
