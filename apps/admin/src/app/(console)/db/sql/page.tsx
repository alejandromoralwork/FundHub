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
import { runReadOnlySql } from "@/lib/sql-actions";
// The browsable tables and a helper to get each one's SQL name.
import { RESOURCES, tableName } from "@/lib/resources";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "SQL console" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the SQL console markup.
 */
export default async function SqlPage() {
  // Only roles in CAN.sql (owner, analyst) may run SQL.
  await requireStaff(CAN.sql);
  // `Object.values(RESOURCES)` = the list of resource settings; `.map(tableName)` turns each into its table
  // name (passing the function itself, which `.map` calls once per item).
  return <SqlConsole run={runReadOnlySql} tables={Object.values(RESOURCES).map(tableName)} />;
}
