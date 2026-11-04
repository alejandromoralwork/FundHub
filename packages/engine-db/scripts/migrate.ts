/**
 * FILE: packages/engine-db/scripts/migrate.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: Applies pending SQL migrations from packages/engine-db/drizzle to the engine database.
 *   Safe to run repeatedly: Drizzle records which migrations already ran. Also enables the pg_trgm
 *   extension used for fuzzy name matching.
 * WHERE IT RUNS: from the command line (`npm run engine:db:migrate`) and at container start.
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { engineDirectUrl } from "../src/env";

/**
 * Kind: async function. Opens one connection, applies migrations, closes it.
 * @returns `Promise<void>`.
 */
async function main() {
  const pool = new Pool({ connectionString: engineDirectUrl(), max: 1 });
  // Trigram similarity for fuzzy name matching. Needs CREATE privilege; ignored if already present.
  await pool.query("create extension if not exists pg_trgm");
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  await pool.end();
  console.log("✔ Engine migrations applied");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
