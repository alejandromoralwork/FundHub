/**
 * One-off copy of all data from the old Turso (SQLite) database into Postgres.
 * Run after `npm run db:migrate` against an empty Postgres database:
 *
 *   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… DATABASE_URL=postgres://… npm run db:from-turso
 *
 * Website sessions are not copied (users simply log in again). Former "admin" website users
 * become provider accounts; staff accounts are created separately in the admin platform.
 */
import "dotenv/config";
import { createClient } from "@libsql/client";
import { Pool } from "pg";
import { migrationUrl } from "../src/env";

/** Copy order respects foreign keys. */
const TABLES = ["providers", "users", "rfi_requests", "provider_claims", "profile_edits", "reports", "reviews"];

async function main() {
  const tursoUrl = process.env.TURSO_DATABASE_URL;
  if (!tursoUrl) throw new Error("Set TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN)");
  const turso = createClient({ url: tursoUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  const pg = new Pool({ connectionString: migrationUrl(), max: 1 });

  for (const table of TABLES) {
    const { rows: cols } = await pg.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type from information_schema.columns where table_schema = 'public' and table_name = $1`,
      [table],
    );
    const pgTypes = new Map(cols.map((c) => [c.column_name, c.data_type]));
    const source = await turso.execute(`select * from ${table}`).catch(() => null);
    if (!source) {
      console.log(`• ${table}: not in Turso, skipped`);
      continue;
    }

    let copied = 0;
    for (const row of source.rows) {
      const record: Record<string, unknown> = {};
      for (const [col, value] of Object.entries(row)) {
        const type = pgTypes.get(col);
        if (!type) continue; // column dropped in Postgres (e.g. users.role)
        record[col] = convert(value, type);
      }
      if (table === "users") record.account_type = "provider";

      const keys = Object.keys(record);
      const res = await pg.query(
        `insert into ${table} (${keys.map((k) => `"${k}"`).join(", ")}) values (${keys.map((_, i) => `$${i + 1}`).join(", ")}) on conflict do nothing`,
        keys.map((k) => record[k]),
      );
      copied += res.rowCount ?? 0;
    }

    // Keep serial sequences ahead of the copied ids.
    if (pgTypes.has("id") && pgTypes.get("id") === "integer") {
      await pg.query(`select setval(pg_get_serial_sequence('${table}', 'id'), greatest((select max(id) from ${table}), 1))`);
    }
    console.log(`✔ ${table}: ${copied}/${source.rows.length} rows copied`);
  }

  await pg.end();
  turso.close();
}

function convert(value: unknown, pgType: string): unknown {
  if (value === null || value === undefined) return null;
  switch (pgType) {
    case "timestamp with time zone":
      return new Date(Number(value) * 1000); // SQLite stored unix seconds
    case "jsonb":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "boolean":
      return Boolean(Number(value));
    case "bytea":
      return Buffer.from(value as ArrayBuffer);
    default:
      return value;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
