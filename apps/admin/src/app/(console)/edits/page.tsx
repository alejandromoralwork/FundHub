/**
 * FILE: apps/admin/src/app/(console)/edits/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Provider self-edits" page. Companies that have claimed their profile can change it on
 *   the website; each change is recorded. This page shows the latest 200 of those changes (which provider,
 *   who made it, what changed) so staff can check them.
 * WHERE IT RUNS: on the server (Node.js), as a server component reading the database; EditsView runs in the
 *   browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/edits = the URL /admin/edits ("(console)" is a route group, not
 *   part of the URL; /admin is the basePath).
 * TYPESCRIPT YOU WILL SEE HERE: method chaining for a query, `as` type assertions, `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM helpers: `desc` = sort descending, `eq` = "equals".
import { desc, eq } from "drizzle-orm";
// `@fundhub/…` = our shared packages. Database connection and tables.
import { db } from "@fundhub/db/client";
import { profileEdits, providers, users } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The list component and the type of one row.
import { EditsView, type EditRow } from "@/components/moderation-views";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Provider self-edits" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the list markup.
 */
export default async function EditsPage() {
  // Moderators only (owner, operations).
  await requireStaff(CAN.moderate);
  // One query, built step by step:
  const rows = await db
    // the columns we want, and the names they get in the result;
    .select({ id: profileEdits.id, providerId: providers.id, providerName: providers.name, userName: users.name, changes: profileEdits.changes, createdAt: profileEdits.createdAt })
    .from(profileEdits)
    // the provider that was edited (innerJoin: it must exist);
    .innerJoin(providers, eq(providers.id, profileEdits.providerId))
    // the user who made the edit (leftJoin: keep the edit even if the account has been deleted);
    .leftJoin(users, eq(users.id, profileEdits.userId))
    // newest first, at most 200.
    .orderBy(desc(profileEdits.createdAt))
    .limit(200);
  // JSON round-trip makes Dates into strings for the browser; `as EditRow[]` labels the type.
  return <EditsView edits={JSON.parse(JSON.stringify(rows)) as EditRow[]} />;
}
