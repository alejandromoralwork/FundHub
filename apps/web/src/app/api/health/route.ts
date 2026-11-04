/**
 * FILE: apps/web/src/app/api/health/route.ts
 * PART: website (apps/web)
 * WHAT IT DOES: A "health check" endpoint at GET /api/health. Monitoring tools (and the server set-up) call it
 *   to ask "is the website up, and can it reach the database?". It runs the simplest possible database query
 *   and answers "ok", or "degraded" with HTTP status 503 if the database cannot be reached.
 * WHERE IT RUNS: on the server (Node.js) only.
 * FRAMEWORK NOTES: route.ts = an API endpoint (not a page); the folder path is the URL (/api/health). The
 *   exported `GET` function answers HTTP GET requests. `dynamic = "force-dynamic"` stops Next.js from running
 *   it once at build time and caching the answer: a health check must be checked live on every call.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async`/`await`, `try { ... } catch (err) { ... }` for handling errors.
 *   - a "tagged template" sql`...`: a template string handed to a function (`sql`) to build a SQL query.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next/server"/"drizzle-orm" = npm libraries;
// "@fundhub/..." = FundHub's shared packages in packages/.
// `NextResponse`: builds HTTP responses such as JSON replies.
import { NextResponse } from "next/server";
// `sql`: Drizzle ORM helper for writing raw SQL safely.
import { sql } from "drizzle-orm";
// `db`: the shared database connection (Drizzle ORM over Postgres).
import { db } from "@fundhub/db/client";

// Always run live; never cache (see FRAMEWORK NOTES).
export const dynamic = "force-dynamic";

/**
 * Kind: async function (Next.js route handler for HTTP GET).
 * Parameters: none (the request itself is not needed).
 * Returns: `Promise<NextResponse>`: JSON `{ status, database }`, with HTTP 200 when healthy or 503
 *   ("service unavailable") when the database does not answer.
 */
export async function GET() {
  // `try { ... }` runs code that might fail; if anything inside throws an error, control jumps to `catch`.
  try {
    // "select 1" is a do-nothing query: it only proves the database is reachable and answering.
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ok", database: "ok" });
  } catch (err) {
    // Write the error to the server log for diagnosis, then report the problem to the caller.
    console.error("Health check failed", err);
    return NextResponse.json({ status: "degraded", database: "unreachable" }, { status: 503 });
  }
}
