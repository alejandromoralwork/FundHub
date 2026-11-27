/**
 * FILE: packages/engine-db/src/client.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: Creates the connection pool and Drizzle `db` object for the Scraping Engine database.
 *   Used by the engine (long-running Node processes) and by the admin console (Next.js, possibly serverless),
 *   so — like packages/db/src/client.ts — the pool is kept on `globalThis` to survive hot reloads and warm
 *   serverless invocations, and stays small on Vercel.
 * WHERE IT RUNS: on Node.js only (engine workers / CLI, admin console server code).
 * TYPESCRIPT YOU WILL SEE HERE: `import * as schema`, `as unknown as {...}`, `??`, `export type X = typeof y`.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { engineDatabaseUrl } from "./env";
import * as schema from "./schema";

const globalForEngine = globalThis as unknown as { enginePgPool?: Pool };

/**
 * Kind: constant. The shared pool; ENGINE_DB_POOL_MAX caps connections (default 2 on Vercel, 10 elsewhere).
 * On Vercel each warm function instance keeps its own pool, and a frozen instance cannot run its idle timer:
 * small pools, short idle time, and the server closes console sessions idle for 60 s (role setting
 * idle_session_timeout, infra/vm/bin/engine-db-remote-access.sh).
 */
export const pool =
  globalForEngine.enginePgPool ??
  new Pool({
    connectionString: engineDatabaseUrl(),
    max: Number(process.env.ENGINE_DB_POOL_MAX ?? (process.env.VERCEL ? 2 : 10)),
    idleTimeoutMillis: process.env.VERCEL ? 10_000 : 30_000,
    allowExitOnIdle: !!process.env.VERCEL,
  });
// An idle connection closed by the server (idle_session_timeout, restart) emits "error" on the pool; without a
// listener Node would crash the process. The pool drops that client and opens a new one on the next query.
if (!globalForEngine.enginePgPool) pool.on("error", (err) => console.warn("engine db: idle connection closed:", err.message));
globalForEngine.enginePgPool = pool;

/** Kind: constant. The Drizzle database object with every engine table. */
export const db = drizzle(pool, { schema });
/** Kind: type alias. The type of `db` — also matches a transaction (`db.transaction(async (tx) => …)`). */
export type EngineDb = typeof db;
/** Kind: type alias. Either the db or a transaction inside it. */
export type EngineTx = Parameters<Parameters<EngineDb["transaction"]>[0]>[0] | EngineDb;
export { schema };
