/**
 * FILE: packages/db/src/client.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: Creates the single shared database connection pool and the Drizzle `db` object that the
 *   website and the console use for every query (`db.select()…`, `db.insert()…`).
 * WHERE IT RUNS: on the server only (Node.js). Browsers can never connect to the database directly;
 *   the password in the connection string must stay on the server.
 * FRAMEWORK NOTES: Drizzle ORM is a library that lets us write database queries in TypeScript; it turns
 *   them into SQL and sends them through the "pg" driver. Passing `schema` lets Drizzle know our tables
 *   so it can offer `db.query.<table>.findMany(...)` style queries with full type checking.
 * TYPESCRIPT YOU WILL SEE HERE: `import * as x` (import a whole module as one object), type assertion
 *   `as unknown as {...}`, optional property `pgPool?:`, `??` (nullish coalescing), ternary `c ? a : b`,
 *   number separators `10_000`, `export type X = typeof y` (a type copied from a value).
 */

// `import { a } from "b"` brings named items from another module.
// `drizzle(pool, …)` wraps a pg connection pool in Drizzle's query builder.
import { drizzle } from "drizzle-orm/node-postgres";
// `Pool` = a connection pool from the "pg" Postgres driver. Opening a database connection is slow (network
// handshake, login), so a pool keeps a few connections open and lends one to each query, then takes it back.
import { Pool } from "pg";
// Picks the right database address for this environment (see env.ts).
import { databaseUrl } from "./env";
// `import * as schema` = import every table definition from schema.ts, grouped in one object called schema.
import * as schema from "./schema";

// Reuse one pool across hot reloads in dev and across invocations of a warm serverless instance.
// `globalThis` is the one global object shared by all code in the running process. In development Next.js
// reloads files when you edit them; without this trick each reload would open a new pool and leak
// connections. `as unknown as { pgPool?: Pool }` tells TypeScript "treat globalThis as an object that may
// have a pgPool property" (`?` = optional). It changes nothing at run time; it only informs type checking.
const globalForDb = globalThis as unknown as { pgPool?: Pool };

// `a ?? b` = use `a` if it exists, otherwise `b`. So: reuse the saved pool, or create a new one.
const pool =
  globalForDb.pgPool ??
  new Pool({
    connectionString: databaseUrl(),
    // Serverless functions run many instances; keep each one's footprint small.
    // `max` = most connections this pool may open. On Vercel (process.env.VERCEL is set there) many copies
    // of the app may run at once, and the database allows only so many connections in total, so use 3;
    // locally use 10. The ternary `c ? x : y` means "if c then x else y".
    max: process.env.VERCEL ? 3 : 10,
    // Close a connection that has been unused for 10 seconds (10_000 ms; `_` is just a readable separator).
    idleTimeoutMillis: 10_000,
  });
// Save the pool on the global object so the next reload finds and reuses it.
globalForDb.pgPool = pool;

/**
 * Kind: constant (the Drizzle database object).
 * Everything else imports `db` to run queries. `{ schema }` is shorthand for `{ schema: schema }`.
 */
export const db = drizzle(pool, { schema });
/**
 * Kind: type alias. `typeof db` takes the TypeScript type of the `db` value, so other files can say
 * "a parameter of type Db" (e.g. a database transaction that behaves like db) without repeating it.
 */
export type Db = typeof db;
// Also share the raw pool (for plain SQL or closing connections) and the table definitions.
export { pool, schema };
