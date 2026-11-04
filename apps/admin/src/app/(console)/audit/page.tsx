/**
 * FILE: apps/admin/src/app/(console)/audit/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Audit log" page. It lists the latest 1,000 actions staff have taken in the Console
 *   (who changed what, and when), newest first, so changes can be traced afterwards.
 * WHERE IT RUNS: on the server (Node.js), as a server component that reads the database, then renders a
 *   browser-side table component with the results.
 * FRAMEWORK NOTES: page.tsx inside app/ = a web page; this one is at /admin/audit ("(console)" is a route
 *   group and does not appear in the URL; /admin is the Console's basePath).
 * TYPESCRIPT YOU WILL SEE HERE: `import type` and inline `type` imports, `async`/`await`, method chaining
 *   (`a.b().c()`), type assertions `as X`, arrays of strings.
 */

// `import { a } from "b"` loads named exports from a module.
// Type for the page's metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM helpers (an npm library that writes SQL for us): `desc` = sort descending, `eq` = "equals".
import { desc, eq } from "drizzle-orm";
// `@fundhub/…` = our own shared packages in packages/. `db` is the connection to the Postgres database.
import { db } from "@fundhub/db/client";
// The table definitions: the audit log itself and the staff accounts (to show the person's name).
import { auditLog, staffUsers } from "@fundhub/db/schema";
// `@/…` = this app's src folder. AuditView is the table component; `type AuditRow` (inline `type`) imports
// only the TypeScript type describing one row.
import { AuditView, type AuditRow } from "@/components/ops-views";
// Login/role check for staff.
import { requireStaff } from "@/lib/auth";

/** Kind: constant. Browser-tab title for this page, read by Next.js. */
export const metadata: Metadata = { title: "Audit log" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the audit table markup, arriving later because the function is `async`.
 */
export default async function AuditPage() {
  // Only these staff roles may look at the audit log; anyone else is redirected to the home page.
  // `["owner", "operations", "analyst"]` is an array (a list) of role names.
  await requireStaff(["owner", "operations", "analyst"]);
  // Build and run one SQL query with Drizzle. Each chained call adds a piece of the query:
  // `.select({ … })` = which columns to fetch, and the name each one gets in the result;
  const rows = await db
    .select({ id: auditLog.id, action: auditLog.action, entity: auditLog.entity, entityId: auditLog.entityId, changes: auditLog.changes, staffName: staffUsers.name, createdAt: auditLog.createdAt })
    // `.from(auditLog)` = "FROM audit_log";
    .from(auditLog)
    // `.leftJoin(...)` = also look up the matching staff member; "left" keeps the log row even if the staff
    // account no longer exists (the name is then null). `eq(a, b)` = "a = b".
    .leftJoin(staffUsers, eq(staffUsers.id, auditLog.staffUserId))
    // Newest first.
    .orderBy(desc(auditLog.createdAt))
    // At most 1,000 rows, to keep the page fast.
    .limit(1000);
  // `JSON.parse(JSON.stringify(rows))` turns Dates etc. into plain strings so the data can be passed to a
  // browser component. `as AuditRow[]` is a type assertion: we tell TypeScript "treat this as a list of
  // AuditRow" (the round-trip loses the original type information).
  return <AuditView rows={JSON.parse(JSON.stringify(rows)) as AuditRow[]} />;
}
