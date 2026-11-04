/**
 * One-off copy of all data from the old Turso (SQLite) database into Postgres.
 * Run after `npm run db:migrate` against an empty Postgres database:
 *
 *   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… DATABASE_URL=postgres://… npm run db:from-turso
 *
 * Website sessions are not copied (users simply log in again). Former "admin" website users
 * become provider accounts; staff accounts are created separately in the admin platform.
 */
/**
 * FILE: packages/db/scripts/migrate-from-turso.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: FundHub used to store its data in Turso, a hosted SQLite database. This script reads every
 *   row of each listed table from Turso and inserts it into the same table in Postgres, converting values
 *   whose storage differs between the two systems (dates, true/false, JSON, binary files).
 * WHERE IT RUNS: once, from a developer's terminal (Node.js). It is not part of the website.
 * FRAMEWORK NOTES: no ORM here: it sends plain SQL text through the "pg" driver, because it must work
 *   table by table without knowing each table's columns in advance. It asks Postgres for the columns.
 * TYPESCRIPT YOU WILL SEE HERE: generics `query<{...}>(...)` (telling TypeScript the shape of the rows),
 *   `Record<string, unknown>` (an object with any text keys and values of unknown type), `Map`,
 *   `for … of` loops, destructuring `{ rows: cols }`, `??` (use the right side if the left is null/undefined),
 *   `switch`, type assertion `as ArrayBuffer`, template strings.
 */

// Loads .env into process.env.
import "dotenv/config";
// Client library for Turso / libSQL (the old SQLite database), installed from npm.
import { createClient } from "@libsql/client";
// Postgres connection pool from the "pg" driver (see scripts/migrate.ts for what a pool is).
import { Pool } from "pg";
// Direct (non-pooled) Postgres address from this package's src/env.ts.
import { migrationUrl } from "../src/env";

/** Copy order respects foreign keys. */
/**
 * Kind: constant (an array of table names).
 * A "foreign key" is a column that points at a row in another table (e.g. reviews.provider_id points at
 * providers.id). Postgres refuses a row whose pointer leads nowhere, so parent tables (providers, users)
 * must be filled before the tables that point at them.
 */
const TABLES = ["providers", "users", "rfi_requests", "provider_claims", "profile_edits", "reports", "reviews"];

/**
 * Kind: async function.
 * Connects to both databases and copies each table in TABLES.
 * @returns `Promise<void>`.
 */
async function main() {
  // process.env holds environment variables. The value may be missing, so its type is `string | undefined`.
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  // `throw new Error(...)` stops the script with a message. After this check TypeScript knows tursoUrl is a string.
  if (!tursoUrl) throw new Error("Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN)");
  // Open the Turso connection.
  const turso = createClient({ url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  // Open a Postgres pool with a single connection (we do one thing at a time).
  const pg = new Pool({ connectionString: migrationUrl(), max: 1 });

  // `for (const table of TABLES)` = repeat the block once for each table name, in order.
  for (const table of TABLES) {
    // Ask Postgres which columns this table has and their types. information_schema.columns is a built-in
    // catalogue view that describes every column of every table. `$1` is a placeholder filled safely by the
    // driver with the first value in the array `[table]` (this avoids SQL injection).
    // `query<{ column_name: string; data_type: string }>` tells TypeScript the shape of each returned row.
    // `const { rows: cols } = …` takes the `rows` property of the result and names it `cols`.
    const { rows: cols } = await pg.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1`,
      [table],
    );
    // Build a lookup table: column name -> Postgres type, e.g. "created_at" -> "timestamp with time zone".
    // `.map(c => [a, b])` turns each row into a pair; `new Map(pairs)` builds a quick lookup from them.
    const pgTypes = new Map(cols.map((c) => [c.column_name, c.data_type]));
    // Read every row of the same table from Turso. If the table does not exist there, the query fails;
    // `.catch(() => null)` turns that failure into the value `null` instead of crashing.
    // (The table name is put straight into the SQL text; that is fine because it comes from our own list.)
    const source = await turso.execute(`select * from ${table}`).catch(() => null);
    if (!source) {
      console.log(`• ${table}: not in Turso, skipped`);
      // `continue` jumps to the next table in the loop.
      continue;
    }

    // `let` (unlike `const`) allows the value to change: we count inserted rows.
    let copied = 0;
    for (const row of source.rows) {
      // `Record<string, unknown>` = an object whose keys are text and whose values can be anything.
      // We fill it with column -> converted value for this one row.
      const record: Record<string, unknown> = {};
      // Object.entries(row) gives [columnName, value] pairs; `[col, value]` unpacks each pair.
      for (const [col, value] of Object.entries(row)) {
        const type = pgTypes.get(col);
        if (!type) continue; // column dropped in Postgres (e.g. users.role)
        // Convert the SQLite value into what Postgres expects for that column type (see convert below).
        record[col] = convert(value, type);
      }
      // Business rule: every old website user becomes a provider account (staff now live elsewhere).
      if (table === "users") record.account_type = "provider";

      // The column names of this row.
      const keys = Object.keys(record);
      // Build: insert into providers ("id", "name", …) values ($1, $2, …) on conflict do nothing
      // - Column names are wrapped in double quotes, Postgres's way of quoting identifiers.
      // - `$${i + 1}` produces "$1", "$2", …: placeholders the driver fills from the array below.
      // - `.join(", ")` glues the array items into one text separated by commas.
      // - "on conflict do nothing" skips a row whose primary key (unique id) already exists, so the
      //   script can be re-run without creating duplicates or failing.
      const res = await pg.query(
        `insert into ${table} (${keys.map((k) => `"${k}"`).join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) on conflict do nothing`,
        keys.map((k) => record[k]),
      );
      // rowCount = number of rows actually inserted (0 if skipped). `?? 0` uses 0 when it is null.
      copied += res.rowCount ?? 0;
    }

    // Keep serial sequences ahead of the copied ids.
    // An auto-numbered ("serial") id column gets its next number from a Postgres "sequence" counter.
    // We inserted rows with their old ids, but the counter does not know that; without this step the next
    // new row would try id 1 and clash. setval() moves the counter to the highest existing id
    // (greatest(…, 1) avoids 0 when the table is empty). pg_get_serial_sequence finds the counter's name.
    if (pgTypes.has("id") && pgTypes.get("id") === "integer") {
      await pg.query(`select setval(pg_get_serial_sequence('${table}', 'id'), greatest((select max(id) from ${table}), 1))`);
    }
    console.log(`✔ ${table}: ${copied}/${source.rows.length} rows copied`);
  }

  // Close both connections so the process can exit.
  await pg.end();
  turso.close();
}

/**
 * Kind: function.
 * Converts one SQLite value into the form Postgres expects for the target column.
 * @param value   type `unknown` — the raw value read from Turso (TypeScript forces us to check it before use).
 * @param pgType  type `string` — the Postgres column type name from information_schema.
 * @returns `unknown`: the converted value, or `null` for an empty value.
 */
function convert(value: unknown, pgType: string): unknown {
  // `===` is strict equality. SQL "NULL" (no value) stays null.
  if (value === null || value === undefined) return null;
  // `switch` picks the `case` matching pgType; `default` handles everything else.
  switch (pgType) {
    case "timestamp with time zone":
      // SQLite stored dates as a count of seconds since 1 Jan 1970; JavaScript Dates count milliseconds.
      return new Date(Number(value) * 1000); // SQLite stored unix seconds
    case "jsonb":
      // jsonb is Postgres's binary JSON type. Send JSON as text; if it is already text keep it as is.
      return typeof value === "string" ? value : JSON.stringify(value);
    case "boolean":
      // SQLite has no true/false type and stored 0 or 1; Number() then Boolean() turns that into false/true.
      return Boolean(Number(value));
    case "bytea":
      // bytea = raw bytes (e.g. an uploaded file). `as ArrayBuffer` tells TypeScript to treat the value as
      // raw binary data; Buffer.from makes the Node.js byte container the pg driver understands.
      return Buffer.from(value as ArrayBuffer);
    default:
      // Text and numbers need no change.
      return value;
  }
}

// Run main(); on failure print the error and exit with code 1 ("failed").
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
