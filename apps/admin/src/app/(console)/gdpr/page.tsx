/**
 * FILE: apps/admin/src/app/(console)/gdpr/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "GDPR requests" page. It lists every data-protection request (e.g. "send me my data",
 *   "delete my data") sorted by deadline, soonest first, so nothing misses its legal due date.
 * WHERE IT RUNS: on the server (Node.js), as a server component reading the database; GdprView runs in the
 *   browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/gdpr = the URL /admin/gdpr ("(console)" is a route group).
 * TYPESCRIPT YOU WILL SEE HERE: `async`/`await`, `as` type assertions.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM helper: `asc` = sort ascending (smallest/earliest first).
import { asc } from "drizzle-orm";
// `@fundhub/…` = our shared packages. Database connection and the GDPR requests table.
import { db } from "@fundhub/db/client";
import { gdprRequests } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The screen and the type of one row.
import { GdprView, type GdprRow } from "@/components/gdpr-view";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "GDPR requests" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the GDPR screen markup.
 */
export default async function GdprPage() {
  // Only roles in CAN.gdpr (owner, operations).
  await requireStaff(CAN.gdpr);
  // `db.select()` with no arguments fetches every column. Earliest deadline first.
  const rows = await db.select().from(gdprRequests).orderBy(asc(gdprRequests.dueAt));
  // JSON round-trip for the browser (Dates -> strings); `as GdprRow[]` labels the type.
  return <GdprView rows={JSON.parse(JSON.stringify(rows)) as GdprRow[]} />;
}
