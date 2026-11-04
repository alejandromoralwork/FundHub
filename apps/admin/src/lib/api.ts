/**
 * FILE: apps/admin/src/lib/api.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Shared helpers for the Console's generic data API (the routes under app/api/resources/…).
 *   The Console's data tables (built with Refine and Ant Design) ask these routes for a page of rows from
 *   any allowed database table, with sorting, searching and filtering, and send edits back. This file checks
 *   the caller is signed in, reads the list options from the URL, builds the SQL WHERE clause safely, runs
 *   the query, and keeps only the columns that may be edited.
 * WHERE IT RUNS: only on the server (Node.js), inside Next.js route handlers (`route.ts` files, which answer
 *   HTTP requests with JSON instead of rendering a page).
 * FRAMEWORK NOTES: `import "server-only"` makes the build fail if browser code ever imports this file.
 *   `NextResponse.json(body, { status })` is Next.js's way to send a JSON reply with an HTTP status code.
 *   Which tables are exposed, and which columns are searchable/editable, is defined in ./resources.ts — an
 *   allow-list, so the API can never touch a table that was not deliberately listed.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - union return types (`Staff | NextResponse`), optional properties (`sort?: string`).
 *   - `Record<string, string>` (object with text keys and text values), `unknown`.
 *   - `ReturnType<typeof fn>` (the type a function returns) and `NonNullable<T>` (T without null/undefined).
 *   - non-null assertion `x!` ("trust me, this is not undefined"), `as unknown as X` (a forced type cast).
 *   - default parameter values (`status = 400`), destructuring, spread `...arr` into a function call.
 *   - `Promise.all` (run several async jobs at the same time), regular expressions `/…/`.
 */

// Makes this module server-only (see FRAMEWORK NOTES).
import "server-only";
// Drizzle ORM (npm library) SQL builders: `and`/`or` combine conditions, `asc`/`desc` set sort direction,
// `count()` = SQL COUNT(*), `eq` = "=", `ilike` = case-insensitive LIKE (text search), `sql` writes raw SQL
// pieces safely. `type SQL` is the type of a built SQL fragment.
import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
// Returns an object listing every column of a Drizzle table definition.
import { getTableColumns } from "drizzle-orm";
// `import type` = only the type is imported (erased at runtime). PgColumn = a Postgres column object.
import type { PgColumn } from "drizzle-orm/pg-core";
// Next.js helper for building HTTP responses.
import { NextResponse } from "next/server";
// `@fundhub/…` = our shared packages. The database connection.
import { db } from "@fundhub/db/client";
// `./…` = files in this folder. Reads the staff session from the cookie; `Staff` is the signed-in user type.
import { getSession, type Staff } from "./auth";
// The allow-list of tables ("resources"): look one up, describe its columns, convert text to column types.
import { coerce, columnsOf, getResource, type ColumnMeta } from "./resources";

/**
 * Kind: async function (exported).
 * Fully authenticated staff for API routes (JSON 401 instead of a redirect).
 * @returns `Promise<Staff | NextResponse>`: either the signed-in staff member, or a ready-made
 *          "401 Not authenticated" response the route should return straight away.
 * Why: pages redirect to the login screen, but an API called by JavaScript needs a JSON error instead.
 * Security: the session must also have passed two-factor (`mfaPassed`), not just the password step.
 */
export async function apiStaff(): Promise<Staff | NextResponse> {
  const s = await getSession();
  // `!s` = no session at all; `||` = or; `!s.mfaPassed` = password OK but 2FA not done yet.
  if (!s || !s.mfaPassed) return NextResponse.json({ message: "Not authenticated" }, { status: 401 });
  return s.staff;
}

/**
 * Kind: constant holding an arrow function (exported).
 * @param message  type `string` — the error text for the client.
 * @param status   type `number`, default 400 ("bad request") when not given (`= 400` is a default value).
 * @returns a JSON `NextResponse` like `{ "message": "…" }` with that HTTP status.
 * `{ message }` is shorthand for `{ message: message }`.
 */
export const jsonError = (message: string, status = 400) => NextResponse.json({ message }, { status });

/**
 * Kind: function (exported).
 * Looks up an allowed table by name and prepares everything the list/edit routes need.
 * @param name  type `string` — the resource name from the URL, e.g. "providers".
 * @returns `null` if the name is not on the allow-list; otherwise an object with:
 *          `def` (the resource definition), `meta` (column descriptions), `cols` (Drizzle column objects by
 *          name), `selection` (which columns to SELECT) and `hasId` (whether the table has an "id" column).
 */
export function loadResource(name: string) {
  const def = getResource(name);
  // Not allowed (or unknown): the caller turns this into a 404.
  if (!def) return null;
  const meta = columnsOf(def);
  // `as unknown as Record<string, PgColumn>` forces TypeScript to treat the columns as a simple
  // "name → column" map. Going through `unknown` is needed when the two types are too different for a direct cast.
  const cols = getTableColumns(def.table) as unknown as Record<string, PgColumn>;
  // Build `{ columnName: columnObject, … }` for the listed columns only (pairs → object, see Object.fromEntries).
  // `cols[m.name]!` — the `!` tells TypeScript the column surely exists.
  const selection = Object.fromEntries(meta.map((m) => [m.name, cols[m.name]!]));
  // `.some(test)` returns true if at least one item passes the test.
  const hasId = meta.some((m) => m.name === "id");
  // Return several values together as one object (shorthand property names).
  return { def, meta, cols, selection, hasId };
}

/**
 * Kind: type alias (exported).
 * The list options a table view can request: which page, how many rows per page, the column to sort by
 * (optional), direction, an optional free-text search `q`, and exact-match filters per column.
 */
export type ListParams = {
  page: number;
  pageSize: number;
  sort?: string;
  order: "asc" | "desc";
  q?: string;
  filters: Record<string, string>;
};

/**
 * Kind: function (exported).
 * Reads list options from the request URL, e.g. `?page=2&pageSize=50&sort=name&order=asc&q=lux&filter[status]=published`.
 * @param url  type `URL` — the parsed request address.
 * @returns `ListParams` with safe values (bad or missing numbers get sensible defaults).
 */
export function parseListParams(url: URL): ListParams {
  // `searchParams` = the part after "?" as key/value pairs.
  const sp = url.searchParams;
  const filters: Record<string, string> = {};
  // Loop over every [key, value] pair (array destructuring in the loop head).
  for (const [k, v] of sp) {
    // Regular expression: matches keys of the form "filter[word]" and captures the word (the column name).
    // `\w+` = letters/digits/underscore only, so odd characters cannot sneak in.
    const m = k.match(/^filter\[(\w+)\]$/);
    // `m[1]` is the captured column name; empty values are ignored.
    if (m && v !== "") filters[m[1]!] = v;
  }
  return {
    // `Number(…)` converts text to a number (NaN if invalid); `|| 1` falls back on NaN/0; at least 1.
    page: Math.max(1, Number(sp.get("page")) || 1),
    // Between 1 and 200 rows per page (default 20): stops someone requesting a million rows at once.
    pageSize: Math.min(200, Math.max(1, Number(sp.get("pageSize")) || 20)),
    // `sp.get` returns null when missing; `?? undefined` turns that into "not set".
    sort: sp.get("sort") ?? undefined,
    // Only "asc" is accepted literally; anything else means "desc".
    order: sp.get("order") === "asc" ? "asc" : "desc",
    // Trimmed search text, or undefined if empty.
    q: sp.get("q")?.trim() || undefined,
    filters,
  };
}

/**
 * Kind: function (exported).
 * Builds the SQL WHERE condition for a list request.
 * @param r  type `NonNullable<ReturnType<typeof loadResource>>` — "whatever loadResource returns, minus the
 *           null case", i.e. a prepared resource.
 * @param p  type `ListParams` — the parsed list options.
 * @returns `SQL | undefined`: the combined condition, or `undefined` for "no WHERE clause" (all rows).
 */
export function buildWhere(r: NonNullable<ReturnType<typeof loadResource>>, p: ListParams): SQL | undefined {
  // Collected conditions, later joined with AND. `SQL[]` = an array of SQL fragments.
  const conds: SQL[] = [];
  // Free-text search, only if there is a search term and this resource lists searchable columns.
  if (p.q && r.def.search?.length) {
    // In SQL LIKE, "%" and "_" are wildcards and "\" escapes. We put a "\" before each of them in the user's
    // text so they are matched literally, then wrap the text in "%…%" ("contains").
    const term = `%${p.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    // For each searchable column: `column::text ILIKE term` (cast to text so numbers can be searched too).
    // The `sql` tag sends values as parameters, never pasted into the SQL, which prevents SQL injection.
    const parts = r.def.search.map((f) => ilike(sql`${r.cols[f]!}::text`, term));
    // A row matches if ANY searchable column contains the term: `or(...parts)` spreads the array as arguments.
    conds.push(or(...parts)!);
  }
  // Exact-match filters. `Object.entries` gives [key, value] pairs.
  for (const [field, raw] of Object.entries(p.filters)) {
    // Security: only filter on columns that really belong to this resource; ignore anything else.
    const m = r.meta.find((c) => c.name === field);
    if (!m) continue;
    // `coerce` converts the text from the URL into the column's type (number, boolean, …).
    // `as never` silences TypeScript, which cannot know the exact column type here.
    conds.push(eq(r.cols[field]!, coerce(m, raw) as never));
  }
  // If there are conditions, AND them together; otherwise no WHERE clause.
  return conds.length ? and(...conds) : undefined;
}

/**
 * Kind: async function (exported).
 * Runs the list query: one page of rows plus the total count (for the pager).
 * @param r  a prepared resource (see buildWhere).
 * @param p  type `ListParams`.
 * @returns `Promise<{ data, total }>`: the rows of this page and the number of matching rows overall.
 */
export async function listRows(r: NonNullable<ReturnType<typeof loadResource>>, p: ListParams) {
  const where = buildWhere(r, p);
  // Sort column: the requested one if it exists on this table; else the resource's default; else "id" if
  // present; else no sorting.
  const sortField = p.sort && r.cols[p.sort] ? p.sort : r.def.defaultSort ?? (r.hasId ? "id" : undefined);
  // Direction: the requested order if the user chose a column; otherwise newest-first for "id" and A→Z for
  // other default columns. The result is a list with one ORDER BY item (or empty).
  const orderBy = sortField ? [(p.sort ? p.order : sortField === "id" ? "desc" : "asc") === "asc" ? asc(r.cols[sortField]!) : desc(r.cols[sortField]!)] : [];
  // `Promise.all([a, b])` runs both queries at the same time and waits for both. The result is destructured:
  // `data` = the rows; `[{ n }]` = the first (only) row of the count query, taking its `n` field.
  const [data, [{ n }]] = await Promise.all([
    db
      .select(r.selection)
      .from(r.def.table)
      .where(where)
      .orderBy(...orderBy)
      // LIMIT/OFFSET pick one page: page 3 of 20 skips the first 40 rows.
      .limit(p.pageSize)
      .offset((p.page - 1) * p.pageSize),
    // SELECT COUNT(*) with the same WHERE, for "showing 1–20 of 345".
    db.select({ n: count() }).from(r.def.table).where(where),
  ]);
  return { data, total: n };
}

/**
 * Kind: function (exported).
 * Validates a write payload against editable columns only.
 * @param meta  type `ColumnMeta[]` — the resource's column descriptions.
 * @param body  type `Record<string, unknown>` — the JSON the browser sent.
 * @returns `Record<string, unknown>`: only the fields that are allowed to change, converted to the right types.
 * Security: anything else in the body (e.g. "id" or a protected column) is silently dropped.
 */
export function writable(meta: ColumnMeta[], body: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const m of meta) {
    // `continue` skips to the next column. `m.name in body` checks whether the field was sent at all.
    if (!m.editable || !(m.name in body)) continue;
    out[m.name] = coerce(m, body[m.name]);
  }
  return out;
}
