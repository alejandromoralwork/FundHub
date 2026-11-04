/**
 * FILE: apps/admin/src/app/(console)/claims/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Company claims" moderation page. When a website user says "I work for this company,
 *   let me manage its profile" (a claim), it lands here. The page loads all pending claims (oldest first, so
 *   they are handled in order) and the 50 most recently decided ones, and passes both lists to the screen.
 * WHERE IT RUNS: on the server (Node.js), as a server component reading the database; the ClaimsView
 *   component it renders runs in the browser and lets staff approve or reject.
 * FRAMEWORK NOTES: page.tsx in app/(console)/claims = the URL /admin/claims ("(console)" is a route group and
 *   is not part of the URL; /admin is the Console's basePath).
 * TYPESCRIPT YOU WILL SEE HERE: object literals, arrow functions returning a value, `Promise.all` with array
 *   destructuring, `unknown`, `as` type assertions, `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM helpers: `desc` = sort descending, `eq` = "equals", `ne` = "not equal".
import { desc, eq, ne } from "drizzle-orm";
// `@fundhub/…` = our shared packages. The database connection.
import { db } from "@fundhub/db/client";
// Tables: the claims, the providers (companies) being claimed, and the website users making the claims.
import { providerClaims, providers, users } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The claims screen and the type of one claim row.
import { ClaimsView, type ClaimRow } from "@/components/moderation-views";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Company claims" };

/**
 * Kind: constant (object).
 * The list of columns to fetch, written once and reused by both queries below. Each key (left) is the name
 * the value gets in the result; each value (right) is a table column. Columns come from three tables:
 * the claim itself, the provider (company) and the user who made the claim.
 * Not exported, so it is private to this file.
 */
const select = {
  id: providerClaims.id,
  status: providerClaims.status,
  jobTitle: providerClaims.jobTitle,
  message: providerClaims.message,
  proposedName: providerClaims.proposedName,
  proposedCategory: providerClaims.proposedCategory,
  proposedWebsite: providerClaims.proposedWebsite,
  createdAt: providerClaims.createdAt,
  reviewedAt: providerClaims.reviewedAt,
  providerId: providers.id,
  providerName: providers.name,
  providerSlug: providers.slug,
  providerWebsite: providers.website,
  userName: users.name,
  userEmail: users.email,
};

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the claims screen markup, arriving later because the function is `async`.
 */
export default async function ClaimsPage() {
  // Only roles in CAN.moderate (owner, operations) may moderate claims.
  await requireStaff(CAN.moderate);
  // `base` is an arrow function that builds (but does not yet run) the shared part of the query:
  // claims joined to their user (innerJoin: must exist) and to their provider (leftJoin: may be missing,
  // e.g. when someone proposes a brand-new company). Calling `base()` twice gives two independent queries.
  const base = () =>
    db.select(select).from(providerClaims).innerJoin(users, eq(users.id, providerClaims.userId)).leftJoin(providers, eq(providers.id, providerClaims.providerId));
  // Run both queries at the same time and name the two results (array destructuring).
  const [pending, recent] = await Promise.all([
    // Claims still waiting for a decision, oldest first.
    base().where(eq(providerClaims.status, "pending")).orderBy(providerClaims.createdAt),
    // Claims already decided, most recently reviewed first, at most 50.
    base().where(ne(providerClaims.status, "pending")).orderBy(desc(providerClaims.reviewedAt)).limit(50),
  ]);
  // Helper: the JSON round-trip turns Dates into strings so the rows can be passed to a browser component;
  // `rows: unknown` accepts any value, and `as ClaimRow[]` labels the result as a list of claim rows.
  const plain = (rows: unknown) => JSON.parse(JSON.stringify(rows)) as ClaimRow[];
  // Render the screen with both lists as props.
  return <ClaimsView pending={plain(pending)} recent={plain(recent)} />;
}
