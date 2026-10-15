import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { databaseUrl } from "./env";
import * as schema from "./schema";

// Reuse one pool across hot reloads in dev and across invocations of a warm serverless instance.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: databaseUrl(),
    // Serverless functions run many instances; keep each one's footprint small.
    max: process.env.VERCEL ? 3 : 10,
    idleTimeoutMillis: 10_000,
  });
globalForDb.pgPool = pool;

export const db = drizzle(pool, { schema });
export type Db = typeof db;
export { pool, schema };
