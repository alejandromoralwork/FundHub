/** Applies pending migrations from ./drizzle. Run by the admin app's build on Vercel. */
/**
 * FILE: packages/db/scripts/migrate.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: Brings the database structure up to date. It reads the numbered .sql migration files in
 *   packages/db/drizzle/ and runs, in order, every one the database has not seen yet. Drizzle remembers
 *   which ones already ran in a bookkeeping table (drizzle.__drizzle_migrations), so running this twice
 *   is safe: the second time there is nothing new to apply.
 * WHERE IT RUNS: on the server / build machine (Node.js), from the command line (`npm run db:migrate`)
 *   and automatically during the console's build on Vercel, so production is updated before new code runs.
 * FRAMEWORK NOTES: Drizzle ORM is the library we use to talk to Postgres from TypeScript. Its "migrator"
 *   is the part that applies migration files.
 * TYPESCRIPT YOU WILL SEE HERE: imports, `async function` / `await` (wait for slow work such as the
 *   database), `new ClassName(...)` (create an object), `.catch(...)` on a Promise, arrow functions.
 */

// `import { a } from "b"` brings named items from another module. "node:…" = built into Node.js;
// plain names = libraries installed from npm; "../src/env" = a file of this package.
// Loads the .env file into process.env (environment variables such as DATABASE_URL).
import "dotenv/config";
// Turns a "file:///…" URL into a normal disk path (C:\… or /…).
import { fileURLToPath } from "node:url";
// `drizzle(pool)` wraps a Postgres connection pool in Drizzle's query API.
import { drizzle } from "drizzle-orm/node-postgres";
// `migrate(db, options)` runs the pending migration files.
import { migrate } from "drizzle-orm/node-postgres/migrator";
// `Pool` from the "pg" library (the standard Postgres driver for Node.js). A connection pool keeps a few
// open connections to the database and lends them out, instead of reconnecting for every query.
import { Pool } from "pg";
// The direct (non-pooled) database address, which migrations need (see src/env.ts).
import { migrationUrl } from "../src/env";

/**
 * Kind: async function (returns a Promise, i.e. a result that arrives later).
 * Opens one connection, applies all pending migrations, then closes the connection.
 * @returns `Promise<void>`: nothing useful, it just finishes (or fails with an error).
 */
async function main() {
  // `new Pool({...})` creates the pool. `max: 1` = at most one connection: migrations run one after
  // another, and a single session keeps things simple and predictable.
  const pool = new Pool({ connectionString: migrationUrl(), max: 1 });
  // `new URL("../drizzle", import.meta.url)` = the drizzle/ folder next to this scripts/ folder.
  // `import.meta.url` is the address of this very file; fileURLToPath turns it into a disk path.
  // `await` pauses until all migrations have run.
  await migrate(drizzle(pool), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  // Close the connection so the Node.js process can exit.
  await pool.end();
  console.log("✔ Migrations applied");
}

// Start the script. `.catch((err) => {...})` runs only if main() fails: print the error and exit with
// code 1, which tells the build system "this step failed" so a broken deploy stops here.
// `(err) => { ... }` is an arrow function: a short way to write an unnamed function.
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
