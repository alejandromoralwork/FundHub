/**
 * FILE: apps/admin/src/app/(console)/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's home page (the dashboard). It loads the headline figures and greets the staff
 *   member by first name. If they were sent here because they tried to open a page their role does not
 *   allow, the URL contains ?denied=1 and the dashboard shows a "no access" notice.
 * WHERE IT RUNS: on the server (Node.js), as a server component; DashboardView runs in the browser.
 * FRAMEWORK NOTES: a page.tsx directly inside app/(console) is the root page. "(console)" is a route group and
 *   not part of the URL, so with the Console's basePath this page is simply /admin. `searchParams` holds the
 *   URL's query string values.
 * TYPESCRIPT YOU WILL SEE HERE: destructured parameters, optional properties `denied?: string`,
 *   `Promise.all` with nested destructuring, `.split(" ")[0]`, non-null `!`, `===` (strict equality).
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// `@/…` = this app's src folder. The dashboard component.
import { DashboardView } from "@/components/dashboard-view";
// Login check.
import { requireStaff } from "@/lib/auth";
// Runs the database queries for the dashboard figures.
import { getDashboard } from "@/lib/metrics";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Dashboard" };

/**
 * Kind: React component (async server component) — the page.
 * @param props  `{ searchParams }` destructured; a Promise of `{ denied?: string }` (from ?denied=1).
 * @returns `Promise<JSX>`: the dashboard markup.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  // Any logged-in staff member; we keep `staff` for their name.
  const staff = await requireStaff();
  // Wait for the figures and the URL values together. `{ denied }` unpacks the second result straight away.
  const [data, { denied }] = await Promise.all([getDashboard(), searchParams]);
  // - data: JSON round-trip so Dates become strings for the browser component.
  // - staffName: `split(" ")` breaks "Jane Smith" into ["Jane", "Smith"]; `[0]` takes "Jane". `!` tells
  //   TypeScript the first item always exists.
  // - denied: true only when the URL said exactly "1" (`===` compares without any type conversion).
  return <DashboardView data={JSON.parse(JSON.stringify(data))} staffName={staff.name.split(" ")[0]!} denied={denied === "1"} />;
}
