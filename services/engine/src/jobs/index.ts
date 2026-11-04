/**
 * FILE: services/engine/src/jobs/index.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: The list of every job: its handler, its worker GROUP (cssf / gleif / rcs / maintenance — a
 *   worker process serves one or more groups), retry policy, and default schedule (cron, Luxembourg time).
 *   Adding a source = add its jobs here; workers and the scheduler pick them up automatically.
 * WHERE IT RUNS: imported by the worker, the scheduler and the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: `Record<string, …>`, `satisfies`, function types.
 */

import { JOB_CATALOG, type JobInfo, type JobName as CatalogName } from "@fundhub/engine-db/jobs-catalog";
import type { JobContext } from "./context";
import { cssfCensus, cssfFetch } from "./cssf";
import { gleifFetch, gleifSync } from "./gleif";
import { censusSnapshot, cssfRefresh, reclassify } from "./maintenance";
import { rcsFetch, rcsFrontier, rcsRefresh, rcsSweep } from "./rcs";
import { rcsImportFile, rcsSeedFrontier } from "./rcs-list";

/** Kind: constant. Worker groups. One RCS worker only (one browser session, human pace). */
export const GROUPS = ["cssf", "gleif", "rcs", "maintenance"] as const;
export type Group = (typeof GROUPS)[number];

/** Kind: type alias. A job definition. */
export type JobDef = {
  group: Group;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (data: any, ctx: JobContext) => Promise<unknown>;
  retryLimit: number;
  /** Seconds before a running job is considered stuck. */
  expireInSeconds: number;
  /** Default cron (Europe/Luxembourg) + data; omit for on-demand jobs. */
  schedule?: { cron: string; data?: Record<string, unknown> };
};

/**
 * Kind: function. One job: its group, title and default schedule come from the shared catalog
 * (packages/engine-db/src/jobs-catalog.ts, also used by the admin console); the handler and queue policy live here.
 */
const job = (name: CatalogName, handler: JobDef["handler"], retryLimit: number, expireInSeconds: number): JobDef => {
  const info: JobInfo = JOB_CATALOG[name];
  return { group: info.group, handler, retryLimit, expireInSeconds, schedule: info.schedule };
};

/** Kind: constant. Every job, keyed like the catalog. Queue names use only letters, digits and "_" (pg-boss rule). */
export const JOBS: Record<CatalogName, JobDef> = {
  cssf_census: job("cssf_census", cssfCensus, 2, 3 * 3600),
  cssf_fetch: job("cssf_fetch", cssfFetch, 5, 300),
  cssf_refresh: job("cssf_refresh", cssfRefresh, 1, 600),
  gleif_sync: job("gleif_sync", gleifSync, 3, 6 * 3600),
  gleif_fetch: job("gleif_fetch", gleifFetch, 5, 300),
  rcs_fetch: job("rcs_fetch", rcsFetch, 3, 600),
  rcs_frontier: job("rcs_frontier", rcsFrontier, 1, 4 * 3600),
  rcs_sweep: job("rcs_sweep", rcsSweep, 2, 4 * 3600),
  rcs_seed_frontier: job("rcs_seed_frontier", rcsSeedFrontier, 1, 600),
  rcs_import_file: job("rcs_import_file", rcsImportFile, 0, 12 * 3600),
  rcs_refresh: job("rcs_refresh", rcsRefresh, 1, 600),
  reclassify: job("reclassify", reclassify, 1, 3 * 3600),
  census_snapshot: job("census_snapshot", censusSnapshot, 2, 600),
};

export type JobName = keyof typeof JOBS;
/** Kind: function. Type guard: is this a known job name? */
export const isJob = (name: string): name is JobName => name in JOBS;

/**
 * Kind: function. An `enqueue` that runs follow-up jobs immediately in this process (CLI inline mode).
 * Delayed jobs (`startAfter`) are skipped with a note: inline mode has no scheduler.
 */
export function inlineEnqueue(getCtx: () => JobContext): JobContext["enqueue"] {
  return async (job, data, opts) => {
    if (!isJob(job)) throw new Error(`Unknown job ${job}`);
    if (opts?.startAfter) {
      console.log(`(inline) skipping delayed ${job} ${JSON.stringify(data)} — needs a worker`);
      return;
    }
    try {
      await (JOBS[job] as JobDef).handler(data, getCtx());
    } catch (err) {
      console.error(`(inline) ${job} ${JSON.stringify(data)} failed: ${err instanceof Error ? err.message : err}`);
    }
  };
}
