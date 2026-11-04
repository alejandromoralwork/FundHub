/**
 * FILE: apps/web/src/app/api/providers/[slug]/route.ts
 * PART: website (apps/web)
 * WHAT IT DOES: A public JSON API endpoint at GET /api/providers/<slug> that returns one published provider
 *   (with its FundHub Score) as JSON, or a 404 error if no published provider has that slug.
 * WHERE IT RUNS: on the server (Node.js) only.
 * FRAMEWORK NOTES: route.ts = an API endpoint; the folder path is the URL. The [slug] folder is a "dynamic
 *   segment": it matches any value, which Next.js passes in as `params.slug` (inside a Promise). The exported
 *   `GET` function answers HTTP GET requests.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async`/`await`; destructuring the second parameter `{ params }` with an inline type.
 *   - a leading underscore `_req` = "this parameter is required by position but not used".
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next/server" = npm library;
// "@fundhub/..." = FundHub's shared packages in packages/.
// `NextResponse`: builds HTTP responses such as JSON replies.
import { NextResponse } from "next/server";
// Database query: one published provider by slug, or `undefined`.
import { getProviderBySlug } from "@fundhub/db/queries";

/**
 * Kind: async function (Next.js route handler for HTTP GET).
 * @param _req        type `Request`: the incoming request (unused, hence the underscore).
 * @param { params }  the route context; `params` is `Promise<{ slug: string }>`, the [slug] part of the URL.
 * @returns           `Promise<NextResponse>`: the provider as JSON, or `{ error }` with status 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  // `(await params).slug`: wait for the route parameters, then read `slug` from them, and look it up.
  const provider = await getProviderBySlug((await params).slug);
  // Not found (or not published): HTTP 404.
  if (!provider) return NextResponse.json({ error: "Provider not found" }, { status: 404 });
  // Found: send the whole provider record as JSON.
  return NextResponse.json(provider);
}
