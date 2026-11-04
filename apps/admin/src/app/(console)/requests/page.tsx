/**
 * FILE: apps/admin/src/app/(console)/requests/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Inbox" page: the forms visitors submit on the website (requests for information,
 *   introductions, etc.). It can be filtered by request type and status through the URL
 *   (e.g. ?type=rfi&status=new), and shows the latest 500 matching requests, newest first.
 * WHERE IT RUNS: on the server (Node.js), as a server component reading the database; InboxView runs in the
 *   browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/requests = the URL /admin/requests. `searchParams` holds the
 *   values after "?" in the URL.
 * TYPESCRIPT YOU WILL SEE HERE: optional properties `type?: string`, `SQL[]` typed arrays, `readonly string[]`,
 *   `as never` (a deliberate type escape hatch), spread arguments `and(...conds)`, ternaries, `undefined`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM helpers: `and`, `desc`, `eq`, and the type `SQL` (one piece of a WHERE condition).
import { and, desc, eq, type SQL } from "drizzle-orm";
// `@fundhub/…` = our shared packages. The allowed request types and statuses (fixed lists).
import { REQUEST_TYPES, RFI_STATUSES } from "@fundhub/core/enums";
// Database connection and tables.
import { db } from "@fundhub/db/client";
import { providers, rfiRequests, staffUsers } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The inbox screen and the type of one row.
import { InboxView, type RequestRow } from "@/components/comms-views";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Inbox" };

/**
 * Kind: React component (async server component) — the page.
 * @param props  `{ searchParams }` destructured; a Promise of `{ type?: string; status?: string }` — both
 *               optional, from the URL.
 * @returns `Promise<JSX>`: the inbox markup.
 */
export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ type?: string; status?: string }> }) {
  // Uses the CAN.email roles (owner, operations, sales) — the people who answer enquiries.
  await requireStaff(CAN.email);
  // Read the two filters from the URL (either may be undefined).
  const { type, status } = await searchParams;
  // A list of WHERE conditions we will build up. `let`-style growth with `.push` works on a `const` array,
  // because `const` only stops the name being pointed at a different array.
  const conds: SQL[] = [];
  // Only accept a filter value that is one of the known values (ignores anything a user typed into the URL).
  // `(REQUEST_TYPES as readonly string[])` widens the fixed list's type so `.includes` accepts any string.
  // `type as never` silences TypeScript, which cannot see that the check above made the value valid.
  if (type && (REQUEST_TYPES as readonly string[]).includes(type)) conds.push(eq(rfiRequests.requestType, type as never));
  if (status && (RFI_STATUSES as readonly string[]).includes(status)) conds.push(eq(rfiRequests.status, status as never));

  // The query: chosen columns plus the assigned staff member's and related provider's names.
  const rows = await db
    .select({
      id: rfiRequests.id,
      requestType: rfiRequests.requestType,
      contactName: rfiRequests.contactName,
      email: rfiRequests.email,
      company: rfiRequests.company,
      fundStructure: rfiRequests.fundStructure,
      aumBand: rfiRequests.aumBand,
      servicesNeeded: rfiRequests.servicesNeeded,
      message: rfiRequests.message,
      status: rfiRequests.status,
      internalNotes: rfiRequests.internalNotes,
      crmRef: rfiRequests.crmRef,
      assignedName: staffUsers.name,
      providerName: providers.name,
      createdAt: rfiRequests.createdAt,
    })
    .from(rfiRequests)
    // Both left joins: a request may be unassigned and may not be about one provider.
    .leftJoin(staffUsers, eq(staffUsers.id, rfiRequests.assignedTo))
    .leftJoin(providers, eq(providers.id, rfiRequests.providerId))
    // With conditions: "WHERE c1 AND c2" (`...conds` spreads the list into separate arguments).
    // Without: `undefined`, which Drizzle treats as "no WHERE at all".
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(rfiRequests.createdAt))
    .limit(500);
  // JSON round-trip for the browser; also pass back the current filters so the screen can show them.
  return <InboxView rows={JSON.parse(JSON.stringify(rows)) as RequestRow[]} filters={{ type, status }} />;
}
