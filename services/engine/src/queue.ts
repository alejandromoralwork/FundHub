/**
 * FILE: services/engine/src/queue.ts
 * PART: scraping engine (services/engine)
 * WHAT IT DOES: The job queue, built on pg-boss (a queue stored in Postgres — in the engine database's
 *   "pgboss" schema — so no Redis or extra service is needed anywhere). It provides:
 *   - `startWorker(groups)`: serves the jobs of the given groups (retries, backoff and timeouts by pg-boss);
 *   - `startScheduler()`: registers the cron schedules from jobs/index.ts;
 *   - `enqueue(job, data)`: adds one job (used by the CLI and by handlers in worker mode).
 *   Several workers on several machines can share the queue; `singletonKey` avoids duplicate jobs.
 * WHERE IT RUNS: `engine worker …` and `engine scheduler` processes (containers / VM services / laptop).
 * TYPESCRIPT YOU WILL SEE HERE: default import of a class, `process.on("SIGTERM")`, closures.
 */

import PgBoss from "pg-boss";
import { eq } from "drizzle-orm";
import { db } from "@fundhub/engine-db/client";
import { engineDirectUrl } from "@fundhub/engine-db/env";
import { DISABLED_SCHEDULES_KEY } from "@fundhub/engine-db/jobs-catalog";
import { engineSettings } from "@fundhub/engine-db/schema";
import { makeContext, type EnqueueOptions } from "./jobs/context";
import { GROUPS, isJob, JOBS, type Group, type JobDef, type JobName } from "./jobs/index";
import { log } from "./log";

/** Kind: async function. Starts a pg-boss instance and makes sure every job queue exists. */
export async function startBoss(opts: { schedule?: boolean } = {}) {
  const boss = new PgBoss({ connectionString: engineDirectUrl(), schema: "pgboss", schedule: opts.schedule ?? false, max: 4 });
  boss.on("error", (err) => log.error("pg-boss error", { error: String(err) }));
  await boss.start();
  const existing = new Set((await boss.getQueues()).map((q) => q.name));
  for (const [name, def] of Object.entries(JOBS) as [JobName, JobDef][]) {
    const options = { name, retryLimit: def.retryLimit, retryDelay: 60, retryBackoff: true, expireInSeconds: def.expireInSeconds };
    if (existing.has(name)) await boss.updateQueue(name, options);
    else await boss.createQueue(name, options);
  }
  return boss;
}

/** Kind: function. An `enqueue` that sends jobs through pg-boss. */
export function bossEnqueue(boss: PgBoss) {
  return async (job: string, data: Record<string, unknown>, opts: EnqueueOptions = {}) => {
    if (!isJob(job)) throw new Error(`Unknown job ${job}`);
    // pg-boss validates present keys, so only pass the options that are set.
    const send: PgBoss.SendOptions = {};
    if (opts.singletonKey) send.singletonKey = opts.singletonKey;
    if (opts.startAfter !== undefined) send.startAfter = opts.startAfter;
    if (opts.priority !== undefined) send.priority = opts.priority;
    await boss.send(job, data, send);
  };
}

/** Kind: function. Stops cleanly on Ctrl+C / container stop, letting the current job finish. */
function onShutdown(fn: () => Promise<void>) {
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log.info("shutting down…");
    await fn().catch((err) => log.error("shutdown error", { error: String(err) }));
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

/**
 * Kind: async function. Runs a worker for the given groups until stopped.
 * @param groups  e.g. ["cssf", "gleif", "maintenance"] or ["rcs"].
 */
export async function startWorker(groups: Group[]) {
  for (const g of groups) if (!GROUPS.includes(g)) throw new Error(`Unknown group ${g}. Use: ${GROUPS.join(", ")}`);
  const boss = await startBoss();
  const ctx = makeContext(bossEnqueue(boss), "schedule");
  for (const [name, def] of Object.entries(JOBS) as [JobName, JobDef][]) {
    if (!groups.includes(def.group)) continue;
    // One job at a time per queue: politeness delays are per process, and RCS is one browser.
    await boss.work(name, { batchSize: 1, pollingIntervalSeconds: 5 }, async ([job]) => {
      const started = Date.now();
      try {
        const result = await def.handler(job.data, ctx);
        log.info("job done", { job: name, id: job.id, ms: Date.now() - started, result: result as Record<string, unknown> });
        return result;
      } catch (err) {
        log.error("job failed", { job: name, id: job.id, data: job.data, error: err instanceof Error ? err.message : String(err) });
        throw err;
      }
    });
  }
  log.info("worker started", { groups });
  onShutdown(async () => {
    await boss.stop({ graceful: true, timeout: 60_000 });
    await ctx.close();
  });
}

/** Kind: async function. Registers the cron schedules and keeps the clock running until stopped. */
export async function startScheduler() {
  const boss = await startBoss({ schedule: true });
  const tz = process.env.ENGINE_TZ ?? "Europe/Luxembourg";
  // Switched off by env (deploy-time) or from the admin console (engine_settings, applied live there too).
  const [setting] = await db.select({ value: engineSettings.value }).from(engineSettings).where(eq(engineSettings.key, DISABLED_SCHEDULES_KEY));
  const disabled = new Set([...(process.env.ENGINE_DISABLED_SCHEDULES ?? "").split(",").filter(Boolean), ...((setting?.value as string[] | undefined) ?? [])]);
  for (const [name, def] of Object.entries(JOBS) as [JobName, JobDef][]) {
    if (!def.schedule) continue;
    if (disabled.has(name)) {
      await boss.unschedule(name).catch(() => {});
      log.info("schedule disabled", { job: name });
      continue;
    }
    await boss.schedule(name, def.schedule.cron, def.schedule.data ?? {}, { tz, singletonKey: `schedule:${name}` });
    log.info("scheduled", { job: name, cron: def.schedule.cron, tz });
  }
  onShutdown(() => boss.stop({ graceful: true }));
}
