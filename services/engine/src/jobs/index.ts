/**
 * FILE: services/engine/src/jobs/index.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: The list of every job: its handler, its worker GROUP (cssf / gleif / rcs / maintenance — a
 *   worker process serves one or more groups), retry policy, and default schedule (cron, Luxembourg time).
 *   Adding a source = add its jobs here; workers and the scheduler pick them up automatically.
 * WHERE IT RUNS: imported by the worker, the scheduler and the CLI.
 * TYPESCRIPT YOU WILL SEE HERE: `Record<string, …>`, `satisfies`, function types.
 */

import type { JobContext } from "./context";
import { cssfCensus, cssfFetch } from "./cssf";
import { gleifFetch, gleifSync } from "./gleif";
import { censusSnapshot, cssfRefresh, reclassify } from "./maintenance";
import { rcsFetch, rcsFrontier, rcsRefresh, rcsSweep } from "./rcs";

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

/** Kind: constant. Every job. Queue names use only letters, digits and "_" (pg-boss rule). */
export const JOBS = {
  cssf_census: { group: "cssf", handler: cssfCensus, retryLimit: 2, expireInSeconds: 3 * 3600, schedule: { cron: "0 2 * * 0" } },
  cssf_fetch: { group: "cssf", handler: cssfFetch, retryLimit: 5, expireInSeconds: 300 },
  cssf_refresh: { group: "maintenance", handler: cssfRefresh, retryLimit: 1, expireInSeconds: 600, schedule: { cron: "0 3 * * *" } },
  gleif_sync: { group: "gleif", handler: gleifSync, retryLimit: 3, expireInSeconds: 6 * 3600, schedule: { cron: "0 4 * * *" } },
  gleif_fetch: { group: "gleif", handler: gleifFetch, retryLimit: 5, expireInSeconds: 300 },
  rcs_fetch: { group: "rcs", handler: rcsFetch, retryLimit: 3, expireInSeconds: 600 },
  rcs_frontier: { group: "rcs", handler: rcsFrontier, retryLimit: 1, expireInSeconds: 4 * 3600, schedule: { cron: "15 8 * * *", data: { prefix: "B" } } },
  rcs_sweep: { group: "rcs", handler: rcsSweep, retryLimit: 2, expireInSeconds: 4 * 3600, schedule: { cron: "0 10 * * *", data: { prefix: "B" } } },
  rcs_refresh: { group: "maintenance", handler: rcsRefresh, retryLimit: 1, expireInSeconds: 600, schedule: { cron: "30 7 * * *" } },
  reclassify: { group: "maintenance", handler: reclassify, retryLimit: 1, expireInSeconds: 3 * 3600, schedule: { cron: "0 5 * * 0" } },
  census_snapshot: { group: "maintenance", handler: censusSnapshot, retryLimit: 2, expireInSeconds: 600, schedule: { cron: "30 23 * * *" } },
} satisfies Record<string, JobDef>;

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
