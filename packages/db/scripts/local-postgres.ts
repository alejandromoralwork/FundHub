/**
 * Local development database: a real Postgres server run from npm (no Docker needed).
 * Data persists in packages/db/.pg-data. Stop with Ctrl+C.
 *
 *   npm run db:local        (then, in another terminal: npm run db:setup)
 */
/**
 * FILE: packages/db/scripts/local-postgres.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: Starts a private Postgres database server on the developer's own computer, on port 5433,
 *   with a database called "fundhub". The first time, it creates the data folder and the database; later
 *   runs reuse the same data. It keeps running until you press Ctrl+C.
 * WHERE IT RUNS: only on a developer's machine (Node.js). Production uses Neon (a hosted Postgres).
 * FRAMEWORK NOTES: "embedded-postgres" is an npm library that downloads real Postgres program files and
 *   starts them for you, so nobody has to install Postgres or Docker by hand.
 * TYPESCRIPT YOU WILL SEE HERE: imports, `const` (a name whose value never changes), `new` (create an
 *   object from a class), `async`/`await`, template strings `` `…${x}…` ``, the ternary `c ? a : b`,
 *   arrow functions `() => {}`.
 */

// `import { a } from "b"`: bring named items from another module. "node:…" = built into Node.js.
// existsSync(path) answers "does this file or folder exist?" right away (synchronously).
import { existsSync } from "node:fs";
// Turns a "file:///…" URL into a normal disk path.
import { fileURLToPath } from "node:url";
// The library (from npm) that runs a real Postgres server. `import X from` = take the module's default export.
import EmbeddedPostgres from "embedded-postgres";

// The folder that holds the database files: packages/db/.pg-data (one level up from scripts/).
// `import.meta.url` is this file's own address, so the path works wherever the repo lives.
const dataDir = fileURLToPath(new URL("../.pg-data", import.meta.url));
// Port number the server listens on. 5433 (not Postgres's usual 5432) avoids clashing with any other
// Postgres already installed on the machine.
const port = 5433;

// Describe the server we want. Nothing starts yet; this only creates the controller object.
const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  // The built-in Postgres superuser (an all-powerful login). Fine locally, never in production.
  user: "postgres",
  password: "postgres",
  // Shorthand: `port` alone means `port: port` (same name for key and variable).
  port,
  // Keep the data folder when the server stops, so data survives restarts.
  persistent: true,
  // Ignore Postgres's own log lines (an empty arrow function does nothing) to keep the terminal quiet.
  onLog: () => {},
});

/**
 * Kind: async function.
 * Starts the server, creating the data folder and the "fundhub" database the first time.
 * @returns `Promise<void>`: finishes once the server is up; the process then keeps running.
 */
async function main() {
  // `fresh` is true when the data folder does not exist yet, i.e. this is the very first run.
  // `!` means "not".
  const fresh = !existsSync(dataDir);
  // `initialise()` creates an empty Postgres "cluster" (the folder of system files) on first run only.
  if (fresh) await pg.initialise();
  // Start the Postgres server process.
  await pg.start();
  // A Postgres server can hold several databases; create ours on first run.
  if (fresh) await pg.createDatabase("fundhub");
  // Template string: `${port}` inserts the value of `port` into the text.
  // The printed address is a "connection string": postgres://user:password@host:port/database.
  console.log(`✔ Postgres running on postgres://postgres:postgres@localhost:${port}/fundhub`);
  // Ternary `fresh ? A : B` = "if fresh then A else B". db:setup creates the tables (migrations) and
  // sample data on a new database.
  console.log(fresh ? "  New database created. Run `npm run db:setup` in another terminal." : "  Existing data reused.");

  // A function stored in a constant: stops Postgres cleanly, then ends this Node.js process (code 0 = OK).
  const stop = async () => {
    await pg.stop();
    process.exit(0);
  };
  // SIGINT is the signal sent by Ctrl+C; SIGTERM is a polite "please stop" from the operating system.
  // On either one, run `stop` so Postgres shuts down properly and the data files are not left half-written.
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

// Run main(). If anything fails: print the error, try to stop Postgres (ignoring any error from that,
// hence `.catch(() => {})`), then exit with code 1 = "failed".
main().catch(async (err) => {
  console.error(err);
  await pg.stop().catch(() => {});
  process.exit(1);
});
