/**
 * FILE: apps/admin/src/app/(console)/analytics/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Analytics" page of the Console. It gathers the website's usage and growth figures from
 *   the database and passes them to a chart/table component that draws them in the browser.
 * WHERE IT RUNS: on the server (Node.js), as a server component, so it can query the database directly.
 *   The drawing component it renders then runs in the browser.
 * FRAMEWORK NOTES: Next.js turns app/(console)/analytics/page.tsx into the URL /admin/analytics (the
 *   "(console)" route-group folder is left out of the URL, and the Console's basePath /admin is added in front).
 * TYPESCRIPT YOU WILL SEE HERE: `import type`, `async`/`await`, nullish coalescing `a ?? b`, JSX props.
 */

// `import { a } from "b"` loads the named export `a` from module "b".
// Type of the page metadata object (title etc.); `import type` loads only the type, no runtime code.
import type { Metadata } from "next";
// `@/…` = this app's src folder. AnalyticsView is the component that draws the charts.
import { AnalyticsView } from "@/components/analytics-view";
// Checks that the visitor is logged-in staff (otherwise redirects to the login page).
import { requireStaff } from "@/lib/auth";
// Runs the database queries that produce the analytics figures.
import { getAnalytics } from "@/lib/metrics";

/** Kind: constant. Next.js uses an exported `metadata` object for the browser-tab title. */
export const metadata: Metadata = { title: "Analytics" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the markup to show, delivered later because the function is `async`.
 */
export default async function AnalyticsPage() {
  // Any logged-in staff member may see analytics, so no roles are passed. `await` waits for the check.
  await requireStaff();
  // Fetch all the figures from the database.
  const data = await getAnalytics();
  // `JSON.parse(JSON.stringify(data))` turns the data into text and back again. This converts things like
  // Date objects into plain strings, because data handed from a server component to a browser component
  // must be plain (serialisable) values.
  // `process.env.POSTHOG_URL` reads a server setting (environment variable): the address of PostHog, the
  // visitor-analytics tool. `?? null` = "if it is missing (undefined/null), use null instead".
  return <AnalyticsView data={JSON.parse(JSON.stringify(data))} posthogUrl={process.env.POSTHOG_URL ?? null} />;
}
