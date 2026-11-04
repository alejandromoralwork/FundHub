/**
 * FILE: apps/web/src/app/api/stats/route.ts
 * PART: website (apps/web)
 * WHAT IT DOES: A public JSON API endpoint at GET /api/stats that returns headline figures about the
 *   Luxembourg fund-services ecosystem (counts from the index) together with the fee benchmarks per category.
 * WHERE IT RUNS: on the server (Node.js) only.
 * FRAMEWORK NOTES: route.ts = an API endpoint at its folder's URL; the exported `GET` answers HTTP GET.
 *   `dynamic = "force-dynamic"` makes Next.js compute the answer on every call instead of caching a copy
 *   made at build time, so the figures are always current.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Promise.all([...])` with array destructuring `const [a, b] = ...`.
 *   - object spread `{ ...stats, benchmarks }`: copy every property of `stats` into a new object, then add one.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next/server" = npm library;
// "@fundhub/..." = FundHub's shared packages in packages/.
// `NextResponse`: builds HTTP responses such as JSON replies.
import { NextResponse } from "next/server";
// Database queries: overall ecosystem counts, and fee ranges per category.
import { getEcosystemStats, getFeeBenchmarks } from "@fundhub/db/queries";

// Always compute live; never cache (see FRAMEWORK NOTES).
export const dynamic = "force-dynamic";

/**
 * Kind: async function (Next.js route handler for HTTP GET).
 * Parameters: none.
 * Returns: `Promise<NextResponse>`: JSON with all the ecosystem stats plus a `benchmarks` property.
 */
export async function GET() {
  // Run both queries at the same time and wait for both; results come back in the same order.
  const [stats, benchmarks] = await Promise.all([getEcosystemStats(), getFeeBenchmarks()]);
  // One flat JSON object: the stats' own fields, plus the benchmarks.
  return NextResponse.json({ ...stats, benchmarks });
}
