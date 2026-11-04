/**
 * FILE: apps/admin/src/app/(console)/pipeline/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Data pipeline" page. The scraper (services/scraper) collects facts about providers and
 *   stores them as "pending" records for a human to approve. This page loads those pending records (with the
 *   current live values, so staff can see a before/after comparison), the history of scraper runs, the list
 *   of requested scrape jobs, and the published providers (to request a new job for one).
 * WHERE IT RUNS: on the server (Node.js), as a server component reading the database; PipelineView runs in
 *   the browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/pipeline = the URL /admin/pipeline ("(console)" is a route group).
 * TYPESCRIPT YOU WILL SEE HERE: `Promise.all` with destructuring, spread into an array `[...new Set(x)]`,
 *   non-null `!`, `Map`, double assertion `as unknown as X`, `Record<string, unknown>`, destructuring in
 *   arrow-function parameters `({ r, providerName }) => …`, `Object.keys`/`Object.fromEntries`, `?.[k]`,
 *   generic helper `<T,>`, `.toISOString()`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM helpers: `desc` (sort descending), `eq` (equals), `inArray` (SQL "IN (…)", value is in a list).
import { desc, eq, inArray } from "drizzle-orm";
// `@fundhub/…` = our shared packages. Database connection and the tables used.
import { db } from "@fundhub/db/client";
// ingestJobs = scrape requests; ingestRecords = scraped facts awaiting review; ingestRuns = scraper run log.
import { ingestJobs, ingestRecords, ingestRuns, providers, staffUsers } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The pipeline screen and the types of its three lists.
import { PipelineView, type JobRow, type RecordRow, type RunRow } from "@/components/pipeline-view";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Data pipeline" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the pipeline screen markup.
 */
export default async function PipelinePage() {
  // Only roles in CAN.pipeline (owner, operations, analyst).
  await requireStaff(CAN.pipeline);
  // Four queries at the same time; results named in the same order.
  const [pending, runs, jobs, providerList] = await Promise.all([
    // 1) Up to 100 newest pending records. `{ r: ingestRecords, … }` puts the whole record row under `r`,
    //    next to the provider's name.
    db
      .select({ r: ingestRecords, providerName: providers.name })
      .from(ingestRecords)
      .innerJoin(providers, eq(providers.id, ingestRecords.providerId))
      .where(eq(ingestRecords.status, "pending"))
      .orderBy(desc(ingestRecords.createdAt))
      .limit(100),
    // 2) The 100 most recent scraper runs, all columns.
    db.select().from(ingestRuns).orderBy(desc(ingestRuns.startedAt)).limit(100),
    // 3) The 100 most recent scrape jobs, with the provider's and requesting staff member's names
    //    (left joins: either may be missing).
    db
      .select({ id: ingestJobs.id, source: ingestJobs.source, providerName: providers.name, status: ingestJobs.status, requestedBy: staffUsers.name, error: ingestJobs.error, createdAt: ingestJobs.createdAt })
      .from(ingestJobs)
      .leftJoin(providers, eq(providers.id, ingestJobs.providerId))
      .leftJoin(staffUsers, eq(staffUsers.id, ingestJobs.requestedBy))
      .orderBy(desc(ingestJobs.createdAt))
      .limit(100),
    // 4) Published providers for the "new job" picker.
    db.select({ id: providers.id, name: providers.name }).from(providers).where(eq(providers.status, "published")).orderBy(providers.name),
  ]);

  // Live values for the diff, fetched in one query.
  // The distinct provider ids among the pending records: `.map` lists them, `new Set(...)` removes repeats,
  // and `[...set]` spreads the set back into a plain array. `!` = "providerId is never null here".
  const ids = [...new Set(pending.map((p) => p.r.providerId!))];
  // If there are any ids, load those providers' current rows ("WHERE id IN (…)"); otherwise an empty list.
  const live = ids.length ? await db.select().from(providers).where(inArray(providers.id, ids)) : [];
  // Lookup id -> provider row. `as unknown as Record<string, unknown>` first forgets the exact type, then
  // calls it "an object with any text keys", so we can read a column by a key held in a variable below.
  const byId = new Map(live.map((p) => [p.id, p as unknown as Record<string, unknown>]));

  // Shape each pending record for the screen. `: RecordRow[]` declares the result type.
  // `({ r, providerName }) => ({ … })` unpacks each item and returns an object (the extra round brackets
  // around `{ … }` tell JavaScript it is an object, not a function body).
  const records: RecordRow[] = pending.map(({ r, providerName }) => ({
    id: r.id,
    source: r.source,
    providerId: r.providerId!,
    providerName,
    sourceUrl: r.sourceUrl,
    // What the scraper found, e.g. { website: "…", phone: "…" }.
    extracted: r.extracted,
    // For every field the scraper found, the provider's current live value (or null) for side-by-side
    // comparison. `?.[k]` reads key k only if the provider row exists.
    current: Object.fromEntries(Object.keys(r.extracted).map((k) => [k, byId.get(r.providerId!)?.[k] ?? null])),
    // Only one detail of the raw scraped data is sent: whether it was mock (test) data.
    // `(r.raw as { mock?: boolean })` tells TypeScript the shape we expect.
    raw: r.raw ? { mock: (r.raw as { mock?: boolean }).mock ?? false } : null,
    // Dates must be sent to the browser as text; ISO format looks like "2026-10-18T09:00:00.000Z".
    createdAt: r.createdAt.toISOString(),
  }));
  // Generic helper (as in other pages): JSON round-trip to plain data, labelled with type T.
  // (`<T,>`: the comma stops .tsx from reading `<T>` as a JSX tag.)
  const plain = <T,>(x: unknown) => JSON.parse(JSON.stringify(x)) as T;
  return <PipelineView records={plain(records)} runs={plain<RunRow[]>(runs)} jobs={plain<JobRow[]>(jobs)} providers={providerList} />;
}
