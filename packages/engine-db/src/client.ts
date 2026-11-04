/**
 * FILE: packages/engine-db/src/client.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: Creates the connection pool and Drizzle `db` object for the Scraping Engine database.
 *   The engine is a long-running Node process (not serverless), so one ordinary pool is enough.
 * WHERE IT RUNS: on Node.js — engine workers, scheduler and CLI.
 * TYPESCRIPT YOU WILL SEE HERE: `import * as schema`, `export type X = typeof y`.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { engineDatabaseUrl } from "./env";
import * as schema from "./schema";

/** Kind: constant. The shared pool; ENGINE_DB_POOL_MAX caps connections (default 10). */
export const pool = new Pool({
  connectionString: engineDatabaseUrl(),
  max: Number(process.env.ENGINE_DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
});

/** Kind: constant. The Drizzle database object with every engine table. */
export const db = drizzle(pool, { schema });
/** Kind: type alias. The type of `db` — also matches a transaction (`db.transaction(async (tx) => …)`). */
export type EngineDb = typeof db;
/** Kind: type alias. Either the db or a transaction inside it. */
export type EngineTx = Parameters<Parameters<EngineDb["transaction"]>[0]>[0] | EngineDb;
export { schema };
