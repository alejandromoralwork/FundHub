"use server";
/**
 * FILE: apps/admin/src/lib/sql-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Powers the Console's SQL console: an analyst types a SQL query and sees the results as a table.
 *   The query is run so that it can only READ data, never change it, and is stopped after 5 seconds.
 * WHERE IT RUNS: only on the server (Node.js), with a direct connection to Postgres.
 * FRAMEWORK NOTES: `"use server"` (must be the first line) makes the exported async function a Next.js "server
 *   action" the SQL console page can call; it runs on the server. Only exported functions are callable from the
 *   browser; `sqlPool` below is private. As with every action, the caller's role is checked first.
 *   Security is layered ("defence in depth"): role check → audit log → optional read-only database user →
 *   read-only transaction → one statement only → timeout → row limit.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import { Pool, type QueryConfig }`: a value and a type-only import from the same library.
 *   - `as unknown as { … }`: a double type assertion, telling TypeScript to treat a value as a different shape.
 *   - `??=` (assign only if currently null/undefined), `try / catch / finally`, `instanceof Error`.
 *   - `JSON.stringify` with a "replacer" function, `Record<string, unknown>[]`.
 */

// `import { a } from "b"` brings named exports into this file.
// "pg" (node-postgres) is the npm library that talks to Postgres. A `Pool` keeps a few open connections to reuse;
// `QueryConfig` is the type of a query-with-options object.
import { Pool, type QueryConfig } from "pg";
// Our normal database connection pool, renamed here to `mainPool` with `as`.
import { pool as mainPool } from "@fundhub/db/client";
import { pool as enginePool } from "@fundhub/engine-db/client";
// Audit log writer, permission check and role table.
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";

/** Kind: constant. At most 500 rows are sent back to the browser, to keep the page fast. */
const MAX_ROWS = 500;
/**
 * Kind: constant.
 * `globalThis` is the one global object of the running server. Storing the analyst pool on it means that when
 * Next.js reloads this file during development, we reuse the existing pool instead of opening new connections
 * each time. `as unknown as { analystPool?: Pool }` tells TypeScript the global object may hold such a property.
 */
const globalForSql = globalThis as unknown as { analystPool?: Pool; engineAnalystPool?: Pool };

/**
 * Kind: function (private).
 * Prefer the read-only analyst role when configured (defence in depth).
 * A database user that only has read permissions cannot write even if every other safeguard failed.
 * @returns `Pool` — the analyst pool if ANALYST_DATABASE_URL is set, otherwise the main pool.
 */
function sqlPool(): Pool {
  const url = process.env.ANALYST_DATABASE_URL;
  if (!url) return mainPool;
  // `??=` creates the pool only the first time (when `analystPool` is still undefined). `max: 2` = at most two
  // connections, so heavy analyst queries cannot take all of the database's capacity.
  globalForSql.analystPool ??= new Pool({ connectionString: url, max: 2 });
  return globalForSql.analystPool;
}

/**
 * Kind: server action (async function).
 * Runs one read-only SQL query typed by staff.
 * @param query  `string` — the SQL text.
 * @returns      `Promise<…>` (inferred) — either `{ error }` or `{ columns, rows, rowCount, ms, truncated }`:
 *               column names, up to 500 rows, the total row count, the time taken in milliseconds, and whether
 *               rows were cut off.
 */
export async function runReadOnlySql(query: string) {
  return runSql("main", query);
}

/**
 * Kind: async server action (exported). Same as runReadOnlySql, on the Scraping Engine database
 * (ENGINE_ANALYST_DATABASE_URL = a read-only role if set; otherwise the engine pool, still in a read-only transaction).
 * @param query  `string` — one SQL statement.
 */
export async function runReadOnlyEngineSql(query: string) {
  return runSql("engine", query);
}

/**
 * Kind: function (private). The read-only pool of the engine database.
 */
function engineSqlPool(): Pool {
  const url = process.env.ENGINE_ANALYST_DATABASE_URL;
  if (!url) return enginePool;
  globalForSql.engineAnalystPool ??= new Pool({ connectionString: url, max: 2 });
  return globalForSql.engineAnalystPool;
}

/** Kind: async function (private). Runs one read-only statement on the chosen database. */
async function runSql(database: "main" | "engine", query: string) {
  // Only roles in `CAN.sql` (owner, analyst) may run SQL.
  const staff = await requireStaff(CAN.sql);
  // Remove surrounding spaces and one trailing semicolon (`/;\s*$/` = ";" plus optional spaces at the end).
  const text = query.trim().replace(/;\s*$/, "");
  if (!text) return { error: "Enter a query." };
  // Audit BEFORE running, so even a query that fails or times out is recorded. Only the first 2000 characters
  // are stored (`.slice(0, 2000)`) to keep the log small.
  await audit(staff, "sql", database === "engine" ? "engine-database" : "database", null, { query: text.slice(0, 2000) });

  // Borrow one connection from the pool for the whole transaction (all the steps below must use the same one).
  const client = await (database === "engine" ? engineSqlPool() : sqlPool()).connect();
  // Start time, to report how long the query took.
  const started = Date.now();
  // `try { … } catch (err) { … } finally { … }`: run the steps; if anything throws, jump to `catch`;
  // `finally` ALWAYS runs at the end (even after a `return`), so cleanup is guaranteed.
  try {
    // Start a READ ONLY transaction: Postgres itself refuses any INSERT/UPDATE/DELETE inside it.
    await client.query("begin read only");
    // Cancel the query if it runs longer than 5000 ms. `set local` applies only to this transaction.
    await client.query("set local statement_timeout = 5000");
    // The extended protocol rejects multiple statements, so "commit; delete …" can't
    // end the read-only transaction and run a write in autocommit.
    // (`as QueryConfig` is needed because `queryMode` is not in the library's published type.)
    const res = await client.query({ text, queryMode: "extended" } as QueryConfig);
    // Keep at most MAX_ROWS rows. `as Record<string, unknown>[]` = "an array of objects with unknown values".
    const rows = (res.rows as Record<string, unknown>[]).slice(0, MAX_ROWS);
    return {
      // `.map` turns each field description into its name.
      columns: res.fields.map((f) => f.name),
      // Very large whole numbers (`bigint`) cannot be sent to the browser as-is, so the replacer function turns
      // them into text; then `JSON.parse` turns the JSON text back into plain objects. `_k` = unused key name.
      rows: JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
      rowCount: res.rowCount ?? res.rows.length,
      ms: Date.now() - started,
      truncated: res.rows.length > MAX_ROWS,
    };
  } catch (err) {
    // Show Postgres's error message (e.g. a syntax error). `instanceof Error` checks it is a real Error object.
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    // Always undo the transaction (nothing should have changed anyway) and give the connection back to the pool.
    // `.catch(() => {})` ignores an error here so that the release below still happens.
    await client.query("rollback").catch(() => {});
    client.release();
  }
}
