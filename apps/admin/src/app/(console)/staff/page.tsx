/**
 * FILE: apps/admin/src/app/(console)/staff/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Staff" page, where the owner manages Console accounts (who has access, their role,
 *   whether 2FA is set up, whether the account is active, and when they last logged in).
 * WHERE IT RUNS: on the server (Node.js), as a server component reading the database; StaffView runs in the
 *   browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/staff = the URL /admin/staff ("(console)" is a route group).
 * TYPESCRIPT YOU WILL SEE HERE: `async`/`await`, `as` type assertions.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// `@fundhub/…` = our shared packages. Database connection and the staff accounts table.
import { db } from "@fundhub/db/client";
import { staffUsers } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The screen and the type of one row.
import { StaffView, type StaffRow } from "@/components/ops-views";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Staff" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the staff screen markup.
 */
export default async function StaffPage() {
  // Owner only (CAN.staff). Keep the result as `me`, so the screen knows which row is the viewer's own.
  const me = await requireStaff(CAN.staff);
  // All staff accounts, alphabetical. Password hashes and 2FA secrets are deliberately NOT selected.
  const rows = await db
    .select({ id: staffUsers.id, email: staffUsers.email, name: staffUsers.name, role: staffUsers.role, totpEnabled: staffUsers.totpEnabled, active: staffUsers.active, lastLoginAt: staffUsers.lastLoginAt })
    .from(staffUsers)
    .orderBy(staffUsers.name);
  // JSON round-trip for the browser (Dates -> strings); `meId` lets the screen stop you disabling yourself.
  return <StaffView staff={JSON.parse(JSON.stringify(rows)) as StaffRow[]} meId={me.id} />;
}
