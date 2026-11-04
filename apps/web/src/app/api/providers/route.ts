/**
 * FILE: apps/web/src/app/api/providers/route.ts
 * PART: website (apps/web)
 * WHAT IT DOES: A public JSON API endpoint at GET /api/providers that searches the provider index. The same
 *   filters as the Compare page are given in the query string (for example
 *   /api/providers?category=tax&q=lux), and the reply lists the matching providers.
 * WHERE IT RUNS: on the server (Node.js) only.
 * FRAMEWORK NOTES: route.ts = an API endpoint; the folder path is the URL (/api/providers). The exported `GET`
 *   function answers HTTP GET requests. `NextRequest` is Next.js's richer request type, which adds
 *   `nextUrl` for easy access to the URL and its query string.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `type X` inside an import list: imports only a type, alongside normal values.
 *   - `async`/`await`; shorthand object properties `{ count, filters }` (= `{ filters: filters }`).
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next/server" = npm library;
// "@fundhub/..." = FundHub's shared packages in packages/.
// `NextResponse` builds replies; `type NextRequest` is the type of the incoming request.
import { NextResponse, type NextRequest } from "next/server";
// Database query: providers matching a set of filters.
import { searchProviders } from "@fundhub/db/queries";
// Turns raw query-string values into a clean, validated filters object (unknown values are dropped).
import { parseFilters } from "@fundhub/core/filters";

/**
 * Kind: async function (Next.js route handler for HTTP GET).
 * @param req  type `NextRequest`: the incoming request, including its URL.
 * @returns    `Promise<NextResponse>`: JSON `{ count, filters, data }` with the number of matches, the
 *             filters actually applied, and the matching providers.
 */
export async function GET(req: NextRequest) {
  // `req.nextUrl.searchParams` holds the query string; `Object.fromEntries(...)` turns it into a plain
  // object like { category: "tax" }, which `parseFilters` then validates.
  const filters = parseFilters(Object.fromEntries(req.nextUrl.searchParams));
  // Run the search in the database (wait for the result list).
  const data = await searchProviders(filters);
  // Reply with JSON. Echoing `filters` back lets callers see how their query was understood.
  return NextResponse.json({ count: data.length, filters, data });
}
