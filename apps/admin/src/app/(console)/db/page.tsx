/**
 * FILE: apps/admin/src/app/(console)/db/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Database" overview page. It asks Postgres for every table in the database with its
 *   size, counts the rows of each one, matches each table to the Console's list of browsable "resources",
 *   and shows a table of tables. Secret tables (login sessions, password-reset tokens) are marked
 *   "Restricted" and can never be opened.
 * WHERE IT RUNS: on the server (Node.js), as a server component that talks to the database directly; the
 *   TablesOverview component it renders runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/db = the URL /admin/db ("(console)" is a route group and not
 *   part of the URL; /admin is the Console's basePath).
 * TYPESCRIPT YOU WILL SEE HERE: generics `db.execute<{…}>` (telling TypeScript the shape of each row),
 *   tagged template strings sql`…`, `Set` and `Map`, ternaries, `?.` and `??`, non-null `!`, `.map` with an
 *   index, type annotations `const tables: TableRow[]`, `Promise.all`, `Promise.resolve`, `.then`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM's `sql` tag lets us write raw SQL safely: values put inside ${…} are sent as parameters.
import { sql } from "drizzle-orm";
// `@fundhub/…` = our shared packages. The database connection.
import { db } from "@fundhub/db/client";
import { db as engineDb } from "@fundhub/engine-db/client";
// `@/…` = this app's src folder. The overview component and the type of one row it shows.
import { TablesOverview, type TableRow } from "@/components/db-views";
// `can(staff, action)` = true/false permission check; `requireStaff` = login check.
import { can, requireStaff } from "@/lib/auth";
// RESOURCES = the tables the Console lets staff browse; `tableName(def)` = a resource's real SQL table name.
import { RESOURCES, tableName } from "@/lib/resources";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Database" };

/**
 * Kind: constant (a `Set` of strings — a collection where each value appears once and lookups are fast).
 * Tables whose contents are secrets (session/reset token hashes); never browsable.
 */
const RESTRICTED = new Set(["sessions", "staff_sessions", "password_resets"]);

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the overview markup, arriving later because the function is `async`.
 */
export default async function DatabasePage() {
  // Any logged-in staff may see the overview; we keep `staff` to check their role below.
  const staff = await requireStaff();
  // Run a raw SQL query against Postgres's own catalogue tables:
  // - pg_class lists every table; pg_namespace says which schema it is in (we want 'public').
  // - relkind = 'r' means "ordinary table" (not an index or view).
  // - reltuples is Postgres's estimated row count; greatest(…, 0) turns the "unknown" value -1 into 0.
  // - pg_size_pretty(pg_total_relation_size(…)) gives a human size such as "48 kB".
  // `db.execute<{ … }>` is generic: the part in <> tells TypeScript what each returned row looks like.
  // The result object has a `rows` field; `const { rows } = …` takes just that (destructuring).
  const { rows } = await db.execute<{ table_name: string; rows: number; size: string }>(sql`
    select c.relname as table_name,
           greatest(c.reltuples, 0)::bigint as rows,
           pg_size_pretty(pg_total_relation_size(c.oid)) as size
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
    order by c.relname`);

  // reltuples is an estimate (-1/0 before ANALYZE); count small tables exactly.
  // For each table (`rows.map(...)` makes a new list with one item per table) we produce a Promise of a
  // number, and `Promise.all` waits for all of them, giving a list of counts in the same order.
  // - Restricted tables are not queried: `Promise.resolve(x)` wraps the estimate in an already-finished Promise.
  // - Others run "select count(*)". `sql.identifier(name)` inserts the table name safely quoted.
  //   `.then((x) => x.rows[0]!.n)` takes the first row's `n`; `!` tells TypeScript "this row surely exists".
  const exact = await Promise.all(
    rows.map((r) =>
      RESTRICTED.has(r.table_name)
        ? Promise.resolve(Number(r.rows))
        : db.execute<{ n: number }>(sql`select count(*)::int as n from ${sql.identifier(r.table_name)}`).then((x) => x.rows[0]!.n),
    ),
  );

  // Build a lookup from real table name to its Console resource settings.
  // `Object.entries(RESOURCES)` gives [key, def] pairs; we map each to [tableName, { key, def }] and
  // `new Map(...)` turns those pairs into a Map (a dictionary with fast `.get(name)`).
  const byTable = new Map(Object.entries(RESOURCES).map(([key, def]) => [tableName(def), { key, def }]));
  // Turn every database table into one row for the overview. `: TableRow[]` declares the type of the list.
  // `.map((r, i) => …)` also gives the position `i`, used to pick the matching exact count.
  const tables: TableRow[] = rows.map((r, i) => {
    // The resource settings for this table, or undefined if the Console does not know it.
    const reg = byTable.get(r.table_name);
    return {
      table: r.table_name,
      // `?? 0` = use 0 if the count is missing.
      rows: exact[i] ?? 0,
      size: r.size,
      // `reg?.key` = "reg.key, or undefined if reg is missing" (optional chaining); then `?? null`.
      resource: reg?.key ?? null,
      label: reg?.def.label ?? null,
      // Group heading: the resource's own group, else "Restricted" for secret tables, else "System".
      group: reg?.def.group ?? (RESTRICTED.has(r.table_name) ? "Restricted" : "System"),
      // Editable only if this resource lists the viewer's role among those allowed to write.
      // `.includes(x)` = true if the list contains x; `!!` makes the result a plain true/false.
      editable: !!reg?.def.write?.includes(staff.role),
      restricted: RESTRICTED.has(r.table_name),
    };
  });

  // Scraping Engine tables (separate database). Row counts are Postgres estimates there (some tables grow to
  // millions of rows), and an unreachable engine database just leaves its section out.
  try {
    const engine = await engineDb.execute<{ table_name: string; rows: number; size: string }>(sql`
      select c.relname as table_name,
             greatest(c.reltuples, 0)::bigint as rows,
             pg_size_pretty(pg_total_relation_size(c.oid)) as size
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = public and c.relkind = r and c.relname not like __drizzle%
      order by c.relname`);
    for (const r of engine.rows) {
      const reg = byTable.get(r.table_name);
      tables.push({
        table: `engine.${r.table_name}`,
        rows: Number(r.rows),
        size: r.size,
        resource: reg?.key ?? null,
        label: reg?.def.label ?? null,
        group: "Scraping engine",
        editable: !!reg?.def.write?.includes(staff.role),
        restricted: false,
      });
    }
  } catch (err) {
    console.error("engine database unavailable:", err);
  }

  // Render the overview; `canSql` decides whether the "SQL console" button is shown.
  return <TablesOverview tables={tables} canSql={can(staff, "sql")} />;
}
