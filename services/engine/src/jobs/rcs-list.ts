/**
 * FILE: services/engine/src/jobs/rcs-list.ts
 * PART: scraping engine (services/engine) — building the list of RCS entities WITHOUT browsing LBR
 *   rcs_seed_frontier {}         — sets each prefix's `max_known` from the highest RCS number any source
 *                                   knows (GLEIF registeredAs, CSSF, imports), so the frontier and the sweep
 *                                   start from a real number, and writes the "rcs:known" census.
 *   rcs_import_file {file, map?, limit?} — imports an official LBR extract (CSV) through the normal ingest
 *                                   pipeline as source "lbr_bulk" (one record per RCS number).
 *   How the first complete list is built (see README): GLEIF + CSSF give ~75k RCS numbers at once; an
 *   official LBR extract completes it; human-paced browsing with your session fills priority gaps.
 * WHERE IT RUNS: queue "maintenance" workers, or inline from the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: `readFile`, `sql<…>` results, parsing "a=b,c=d" options.
 */

import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { ingest } from "../core/ingest";
import { finishRun, startRun, upsertCensus } from "../core/ops";
import type { RawCapture, SourceAdapter } from "../core/types";
import { log } from "../log";
import { LBR_BULK_PARSER_VERSION, parseCsv, parseLbrBulk, parseLbrRow, resolveColumns, type ColumnMap } from "../sources/lbr-bulk/parse";
import type { JobContext } from "./context";

/** Kind: constant. The adapter for imported rows (nothing to fetch: rows come from the file). */
const lbrBulk: SourceAdapter = {
  source: "lbr_bulk",
  parserVersion: LBR_BULK_PARSER_VERSION,
  fetch: async () => null,
  parse: parseLbrBulk,
};

/**
 * Kind: async function. Writes "rcs:known:<prefix>" census rows: how many distinct RCS numbers we know
 * (from any source) against the size of the number range seen so far (max_known).
 * @returns the rows written.
 */
export async function snapshotRcsKnown() {
  const rows = (
    await db.execute<{ prefix: string; known: number; max: number | null }>(sql`
      select s.prefix, count(distinct i.value)::int as known, s.max_known as max
      from rcs_number_space s
      left join entity_identifiers i on i.scheme = 'rcs' and left(i.value, 1) = s.prefix
      group by s.prefix, s.max_known order by s.prefix`)
  ).rows;
  for (const r of rows) {
    if (!r.known && !r.max) continue;
    await upsertCensus("registry", `rcs:known:${r.prefix}`, { expectedTotal: r.max || null, seen: r.known, active: null, added: null, gone: null });
  }
  return rows;
}

/** Kind: async function. Job "rcs_seed_frontier". */
export async function rcsSeedFrontier() {
  const maxes = (
    await db.execute<{ prefix: string; max: number }>(sql`
      -- The highest number that has another known number within 1000 below it: a lone typo far above the
      -- real range (GLEIF once had B563447 while new companies were around B313xxx) is ignored.
      with n as (
        select left(value, 1) as prefix, substring(value from 2)::int as num
        from entity_identifiers where scheme = 'rcs' and value ~ '^[A-Z][0-9]+$'
      ), d as (
        select prefix, num, num - lag(num) over (partition by prefix order by num) as gap from n
      )
      select prefix, max(num) as max from d where gap is not null and gap <= 1000 group by 1`)
  ).rows;
  for (const m of maxes) {
    await db.execute(sql`update rcs_number_space set max_known = ${m.max}, updated_at = now() where prefix = ${m.prefix} and (max_known < ${m.max} or max_known > ${m.max} + 1000)`);
  }
  const census = await snapshotRcsKnown();
  log.info("rcs frontier seeded", { maxes });
  return { maxes, census };
}

/**
 * Kind: function. Parses "rcs=Numéro RCS,name=Dénomination" into a partial ColumnMap.
 * @param map  type `string | undefined`.
 */
export function parseMapOption(map: string | undefined): Partial<ColumnMap> {
  if (!map) return {};
  return Object.fromEntries(
    map
      .split(",")
      .map((p) => p.split("="))
      .filter(([k, v]) => k && v)
      .map(([k, v]) => [k.trim(), v.trim()]),
  );
}

/** Kind: async function. Job "rcs_import_file". */
export async function rcsImportFile(data: { file: string; map?: string; limit?: number }, ctx: JobContext) {
  if (!data.file) throw new Error("Usage: rcs_import_file --file <extract.csv> [--map rcs=<header>,name=<header>,…] [--limit n]");
  const rows = parseCsv(await readFile(data.file, "utf8"));
  const cols = resolveColumns(rows[0], parseMapOption(data.map));
  const runId = await startRun("lbr_bulk", "rcs_import_file", ctx.trigger, { file: data.file, columns: cols });
  const stats: Record<string, number> = { rows: 0, invalid: 0, new: 0, changed: 0, unchanged: 0, failed: 0 };
  try {
    for (const cells of rows.slice(1)) {
      if (data.limit && stats.rows >= data.limit) break;
      stats.rows++;
      const rec = parseLbrRow(cells, cols);
      if (!rec) {
        stats.invalid++;
        continue;
      }
      const raw: RawCapture = { source: "lbr_bulk", externalId: rec.externalId, url: `file:${data.file}`, httpStatus: null, contentType: "application/json", body: Buffer.from(JSON.stringify(rec)), ext: "json" };
      try {
        const res = await ingest(lbrBulk, raw, { blobs: ctx.blobs, runId });
        stats[res.status] = (stats[res.status] ?? 0) + 1;
      } catch (err) {
        stats.failed++;
        log.warn("lbr row failed", { rcs: rec.externalId, error: String(err) });
      }
      if (stats.rows % 1000 === 0) log.info("lbr import", stats);
    }
    await rcsSeedFrontier();
    await finishRun(runId, "succeeded", stats);
  } catch (err) {
    await finishRun(runId, "failed", stats, String(err));
    throw err;
  }
  return stats;
}
