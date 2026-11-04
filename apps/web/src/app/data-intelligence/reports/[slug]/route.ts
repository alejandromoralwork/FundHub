/**
 * FILE: apps/web/src/app/data-intelligence/reports/[slug]/route.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Serves a Data Intelligence report as a PDF at GET /data-intelligence/reports/<slug>.
 *   A report is either "built in" (defined in code and drawn as a PDF on the fly from live market statistics)
 *   or "uploaded" (a PDF file stored in the database by FundHub staff). Private reports are only for members
 *   and approved providers; anyone else is redirected to the membership page. Every download is logged.
 * WHERE IT RUNS: on the server (Node.js) only.
 * FRAMEWORK NOTES:
 *   - route.ts = an endpoint that returns data (here a PDF file) instead of a web page. The exported `GET`
 *     answers HTTP GET requests (what a browser sends when you click a link).
 *   - [slug] = a "dynamic segment" folder: it matches any value, passed in as `params.slug`.
 *   - `dynamic = "force-dynamic"`: run on every request, never cache a copy, because access depends on who
 *     is logged in and every download must be logged.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Uint8Array`: raw binary data (the bytes of the PDF file).
 *   - ternary `c ? a : b`, nullish coalescing `a ?? b`, optional chaining `a?.b`, non-null assertion `x!`.
 *   - `.find()`, template strings, `async`/`await`, promise `.catch(...)` for handling a failure.
 *   - Drizzle ORM queries: `db.select().from(table).where(eq(column, value))` and `db.insert(table).values()`.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "drizzle-orm"/"next/server" = npm libraries;
// "@/..." = this app's src folder; "@fundhub/..." = FundHub's shared packages in packages/.
// `eq(column, value)`: Drizzle's way to write the SQL condition "column = value".
import { eq } from "drizzle-orm";
// `NextResponse`: builds HTTP responses (JSON, files, redirects).
import { NextResponse } from "next/server";
// The list of reports defined in code, and a helper that gives the current quarter, e.g. "Q4 2026".
import { BUILT_IN_REPORTS, currentQuarter } from "@/content/reports";
// `db`: the shared database connection (Drizzle ORM over Postgres).
import { db } from "@fundhub/db/client";
// Database query: the latest market figures used to fill built-in reports.
import { getMarketStats } from "@fundhub/db/queries";
// Table definitions: `reportDownloads` (the download log) and `reports` (uploaded PDF reports).
import { reportDownloads, reports } from "@fundhub/db/schema";
// Login helpers: who is logged in, and whether they may open private reports.
import { canAccessPrivateReports, getCurrentUser } from "@/lib/auth/session";
// Draws a built-in report as a PDF and returns its bytes.
import { renderReportPdf } from "@/lib/report-pdf";

// Run on every request; never cache (see FRAMEWORK NOTES).
export const dynamic = "force-dynamic";

/**
 * Kind: function (helper, not exported).
 * Wraps PDF bytes in an HTTP response with the right headers.
 * @param body       type `Uint8Array`: the PDF file's bytes.
 * @param filename   type `string`: the name the browser should use if the user saves the file.
 * @param isPrivate  type `boolean`: whether this is a members-only report (controls caching).
 * @returns          `NextResponse`: the PDF response.
 */
function pdfResponse(body: Uint8Array, filename: string, isPrivate: boolean) {
  // `new NextResponse(content, options)` builds a response by hand. `Buffer.from(body)` converts the bytes into
  // Node.js's `Buffer` type, which the response accepts as a body.
  return new NextResponse(Buffer.from(body), {
    headers: {
      // Tells the browser the content is a PDF.
      "Content-Type": "application/pdf",
      // `inline` = open it in the browser's PDF viewer (rather than forcing a download), with this file name.
      "Content-Disposition": `inline; filename="${filename}"`,
      // Private reports must never be cached by shared caches.
      // Public ones may be cached by anyone for an hour (3600 seconds) to save work.
      "Cache-Control": isPrivate ? "private, no-store" : "public, max-age=3600",
    },
  });
}

/**
 * Kind: async function (Next.js route handler for HTTP GET).
 * @param req         type `Request`: the incoming request (used to build an absolute redirect URL).
 * @param { params }  route context; `params` is `Promise<{ slug: string }>`, the report's slug from the URL.
 * @returns           `Promise<NextResponse>`: the PDF, a 404 JSON error, or a redirect to the membership page.
 */
export async function GET(req: Request, { params }: { params: Promise<{ slug: string }> }) {
  // Read the slug from the URL.
  const { slug } = await params;
  // First look among the built-in reports; `.find` gives the matching one or `undefined`.
  const builtIn = BUILT_IN_REPORTS.find((r) => r.slug === slug);
  // Only if it is not built in, look for an uploaded report in the database:
  // SELECT * FROM reports WHERE slug = <slug> LIMIT 1. The query returns an array; `[0]` takes its first row
  // (or `undefined` if there is none).
  const uploaded = builtIn ? undefined : (await db.select().from(reports).where(eq(reports.slug, slug)).limit(1))[0];
  // Neither kind exists: reply 404 "not found".
  if (!builtIn && !uploaded) return NextResponse.json({ error: "Report not found" }, { status: 404 });

  // `builtIn ?? uploaded` picks whichever one was found. The `!` tells TypeScript it cannot be undefined here
  // (the line above already returned in that case), so `.visibility` can be read.
  const isPrivate = (builtIn ?? uploaded)!.visibility === "private";
  // Who is asking (or `null` for an anonymous visitor).
  const user = await getCurrentUser();
  // Private report and the user has no access (not a member, not an approved provider, or not logged in).
  if (isPrivate && !(await canAccessPrivateReports(user))) {
    // Not a member yet: the membership page explains how to join.
    const target = "/data-intelligence/membership";
    // `new URL(target, req.url)` turns the relative path into a full address on this same website, which
    // `NextResponse.redirect` needs.
    return NextResponse.redirect(new URL(target, req.url));
  }

  // Download analytics for the admin platform; never blocks the download.
  // INSERT a row with the report slug and the user's id. `user?.id ?? null`: the id if logged in, otherwise
  // `null` (anonymous download). `.catch(...)` means a logging failure is only written to the server log
  // and the visitor still gets their PDF.
  await db
    .insert(reportDownloads)
    .values({ reportSlug: slug, userId: user?.id ?? null })
    .catch((err) => console.error("Failed to log report download", err));

  // Built-in report: draw the PDF now from the latest market statistics.
  if (builtIn) {
    const pdf = await renderReportPdf(builtIn, await getMarketStats());
    // File name like "fundhub-<slug>-q4-2026.pdf": `.replace(" ", "-")` swaps the space in "Q4 2026" for a
    // dash, and `.toLowerCase()` makes it lower case.
    return pdfResponse(pdf, `fundhub-${builtIn.slug}-${currentQuarter().replace(" ", "-").toLowerCase()}.pdf`, isPrivate);
  }
  // Uploaded report: send the stored PDF bytes as they are. `uploaded!` = "definitely found" (see above).
  return pdfResponse(uploaded!.pdf, `fundhub-${uploaded!.slug}.pdf`, isPrivate);
}
