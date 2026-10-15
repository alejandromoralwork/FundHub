import type { Metadata } from "next";
import { sql } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { TablesOverview, type TableRow } from "@/components/db-views";
import { can, requireStaff } from "@/lib/auth";
import { RESOURCES, tableName } from "@/lib/resources";

export const metadata: Metadata = { title: "Database" };

/** Tables whose contents are secrets (session/reset token hashes); never browsable. */
const RESTRICTED = new Set(["sessions", "staff_sessions", "password_resets"]);

export default async function DatabasePage() {
  const staff = await requireStaff();
  const { rows } = await db.execute<{ table_name: string; rows: number; size: string }>(sql`
    select c.relname as table_name,
           greatest(c.reltuples, 0)::bigint as rows,
           pg_size_pretty(pg_total_relation_size(c.oid)) as size
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`);

  // reltuples is an estimate (-1/0 before ANALYZE); count small tables exactly.
  const exact = await Promise.all(
    rows.map((r) =>
      RESTRICTED.has(r.table_name)
        ? Promise.resolve(Number(r.rows))
        : db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(r.table_name)}`).then((x) => x.rows[0]!.n),
    ),
  );

  const byTable = new Map(Object.entries(RESOURCES).map(([key, def]) => [tableName(def), { key, def }]));
  const tables: TableRow[] = rows.map((r, i) => {
    const reg = byTable.get(r.table_name);
    return {
      table: r.table_name,
      rows: exact[i] ?? 0,
      size: r.size,
      resource: reg?.key ?? null,
      label: reg?.def.label ?? null,
      group: reg?.def.group ?? (RESTRICTED.has(r.table_name) ? "Restricted" : "System"),
      editable: !!reg?.def.write?.includes(staff.role),
      restricted: RESTRICTED.has(r.table_name),
    };
  });

  return <TablesOverview tables={tables} canSql={can(staff, "sql")} />;
}
