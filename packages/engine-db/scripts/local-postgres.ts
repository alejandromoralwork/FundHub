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
import { connect } from "node:net";
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
  // UTF-8 explicitly: on Windows initdb would otherwise pick the system code page (WIN1252), which cannot
  // store Greek, Cyrillic… company names found in GLEIF.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

/**
 * Kind: function. True when something already accepts connections on the port.
 * @param p  type `number`.
 */
function portInUse(p: number): Promise<boolean> {
  return new Promise((done) => {
    const socket = connect({ port: p, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.end();
      done(true);
    });
    socket.once("error", () => done(false));
  });
}

/**
 * Kind: async function. Starts the server, creating the "fundhub_engine" database the first time.
 * @returns `Promise<void>`: finishes once the server is up; the process then keeps running.
 */
async function main() {
  // Already running (another terminal or a background task)? Say so instead of failing with "undefined".
  if (await portInUse(port)) {
    console.log(`✔ Engine Postgres is already running on port ${port} — nothing to do. (Stop the other one first to restart it.)`);
    return;
  }
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
  // embedded-postgres sometimes rejects with `undefined`; give a hint instead of printing nothing useful.
  console.error(err ?? `Postgres did not start. Is another copy using ${dataDir}? Stop it, then try again.`);
  process.exit(1);
});
