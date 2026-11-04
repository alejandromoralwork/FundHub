/**
 * FILE: apps/admin/src/app/(console)/db/sql/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "SQL console" page, where permitted staff can type a read-only SQL query and see the
 *   result. The page itself only checks permissions and passes the query-running server action and the list
 *   of table names (for hints) to the console component.
 * WHERE IT RUNS: on the server (Node.js) as a server component. The SqlConsole component runs in the
 *   browser; when the user presses "run", it calls `runReadOnlySql`, which executes back on the server.
 * FRAMEWORK NOTES: page.tsx in app/(console)/db/sql = the URL /admin/db/sql. Note that this fixed folder name
 *   "sql" wins over the neighbouring dynamic "[resource]" folder, so /admin/db/sql opens this page.
 *   A "server action" is a function in a file marked "use server"; it can be handed to a browser component
 *   as a prop, and calling it from the browser makes Next.js run it on the server and send back the result.
 * TYPESCRIPT YOU WILL SEE HERE: passing a function as a value (`run={runReadOnlySql}`), `Object.values`,
 *   `.map(fn)` with a named function, `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// `@/…` = this app's src folder. The SQL editor/result component.
import { SqlConsole } from "@/components/db-views";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";
// The server action that runs a query in a read-only database transaction.
import { runReadOnlyEngineSql, runReadOnlySql } from "@/lib/sql-actions";
import Link from "next/link";
// The browsable tables and a helper to get each one's SQL name.
import { RESOURCES, tableName } from "@/lib/resources";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "SQL console" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the SQL console markup.
 */
export default async function SqlPage({ searchParams }: { searchParams: Promise<{ db?: string }> }) {
  // Only roles in CAN.sql (owner, analyst) may run SQL.
  await requireStaff(CAN.sql);
  // `?db=engine` switches to the Scraping Engine database (its own Postgres); the website database is the default.
  const engine = (await searchParams).db === "engine";
  // The tables of the chosen database; `.map(tableName)` turns each setting into its table name.
  const defs = Object.values(RESOURCES).filter((d) => (d.database === "engine") === engine);
  return (
    <>
      <p style={{ marginBottom: 8 }}>
        Database: {engine ? <Link href="/db/sql">Website</Link> : <strong>Website</strong>} ·{" "}
        {engine ? <strong>Scraping engine</strong> : <Link href="/db/sql?db=engine">Scraping engine</Link>}
      </p>
      {/* `key` makes React start a fresh console (empty result) when switching database. */}
      <SqlConsole key={engine ? "engine" : "main"} run={engine ? runReadOnlyEngineSql : runReadOnlySql} tables={defs.map(tableName)} />
    </>
  );
}
