/**
 * Local engine database: a real Postgres server run from npm (no Docker needed), on port 5434 so it
 * can run next to the website's local database (5433). Data persists in packages/engine-db/.pg-data.
 *
 *   npm run engine:db:local        (then, in another terminal: npm run engine:db:setup)
 */
/**
 * FILE: packages/engine-db/scripts/local-postgres.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: Starts a private Postgres server with a database called "fundhub_engine". The first time it
 *   creates the data folder and the database; later runs reuse them. Runs until Ctrl+C.
 * WHERE IT RUNS: only on a developer's machine. Deployed engines use a managed Postgres or the compose one.
 * FRAMEWORK NOTES: same approach as packages/db/scripts/local-postgres.ts (the "embedded-postgres" library).
 */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";

const dataDir = fileURLToPath(new URL("../.pg-data", import.meta.url));
const port = 5434;

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
  onLog: () => {},
});

/**
 * Kind: async function. Starts the server, creating the "fundhub_engine" database the first time.
 * @returns `Promise<void>`: finishes once the server is up; the process then keeps running.
 */
async function main() {
  const fresh = !existsSync(dataDir);
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("fundhub_engine");
  console.log(`✔ Engine Postgres running on postgres://postgres:postgres@localhost:${port}/fundhub_engine`);
  console.log(fresh ? "  New database created. Run `npm run engine:db:setup` in another terminal." : "  Existing data reused.");

  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
