"use server";

import { Pool, type QueryConfig } from "pg";
import { pool as mainPool } from "@fundhub/db/client";
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";

const MAX_ROWS = 500;
const globalForSql = globalThis as unknown as { analystPool?: Pool };

/** Prefer the read-only analyst role when configured (defence in depth). */
function sqlPool(): Pool {
  const url = process.env.ANALYST_DATABASE_URL;
  if (!url) return mainPool;
  globalForSql.analystPool ??= new Pool({ connectionString: url, max: 2 });
  return globalForSql.analystPool;
}

export async function runReadOnlySql(query: string) {
  const staff = await requireStaff(CAN.sql);
  const text = query.trim().replace(/;\s*$/, "");
  if (!text) return { error: "Enter a query." };
  await audit(staff, "sql", "database", null, { query: text.slice(0, 2000) });

  const client = await sqlPool().connect();
  const started = Date.now();
  try {
    await client.query("begin read only");
    await client.query("set local statement_timeout = 5000");
    // The extended protocol rejects multiple statements, so "commit; delete …" can't
    // end the read-only transaction and run a write in autocommit.
    const res = await client.query({ text, queryMode: "extended" } as QueryConfig);
    const rows = (res.rows as Record<string, unknown>[]).slice(0, MAX_ROWS);
    return {
      columns: res.fields.map((f) => f.name),
      rows: JSON.parse(JSON.stringify(rows, (_k, v) => (typeof v === "bigint" ? v.toString() : v))),
      rowCount: res.rowCount ?? res.rows.length,
      ms: Date.now() - started,
      truncated: res.rows.length > MAX_ROWS,
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
  }
}
