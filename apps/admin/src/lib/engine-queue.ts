/**
 * FILE: apps/admin/src/lib/engine-queue.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Lets the Console put jobs on the Scraping Engine's queue (pg-boss, stored in the engine database)
 *   and change cron schedules. The Console never RUNS jobs: engine workers (laptop, Docker, Azure VM…) pick
 *   them up. The pg-boss client is send-only (no polling, no maintenance, no schema migration) and is kept on
 *   `globalThis` so hot reloads and warm serverless instances reuse it.
 * WHERE IT RUNS: server only.
 * TYPESCRIPT YOU WILL SEE HERE: a cached `Promise`, default import of a class.
 */

import "server-only";
import PgBoss from "pg-boss";
import { engineDirectUrl } from "@fundhub/engine-db/env";

const globalForBoss = globalThis as unknown as { engineBoss?: Promise<PgBoss> };

/**
 * Kind: function. The shared send-only pg-boss client (started once).
 * @returns `Promise<PgBoss>`.
 * @throws  when the queue schema does not exist yet — start an engine worker once to create it.
 */
export function engineBoss(): Promise<PgBoss> {
  globalForBoss.engineBoss ??= (async () => {
    const boss = new PgBoss({ connectionString: engineDirectUrl(), schema: "pgboss", schedule: false, supervise: false, migrate: false, max: 2 });
    boss.on("error", (err) => console.error("engine queue:", err));
    await boss.start();
    return boss;
  })().catch((err) => {
    globalForBoss.engineBoss = undefined;
    throw new Error(`Engine queue not available (${err instanceof Error ? err.message : err}). Start an engine worker once to create it.`);
  });
  return globalForBoss.engineBoss;
}

/**
 * Kind: async function. Puts one job on the queue (creating the queue if a worker has not yet).
 * @returns `Promise<string | null>` — the job id (null when an identical singleton job is already queued).
 */
export async function sendEngineJob(name: string, data: Record<string, unknown>): Promise<string | null> {
  const boss = await engineBoss();
  if (!(await boss.getQueue(name))) await boss.createQueue(name);
  return boss.send(name, data);
}
