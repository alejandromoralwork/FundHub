/**
 * FILE: apps/admin/src/app/api/resources/[resource]/route.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The JSON API for a whole database table in the Console's database browser, at
 *   /admin/api/resources/<table>. GET returns one page of rows (with paging, sorting, search and filters
 *   read from the URL). POST creates a new row, if this table allows it and the staff member's role may
 *   write to it, and records the creation in the audit log.
 * WHERE IT RUNS: on the server (Node.js) only; the browser's list and create screens call it.
 * FRAMEWORK NOTES: a route.ts file is an API endpoint. Exported functions named GET and POST answer those
 *   HTTP methods. "[resource]" is a dynamic URL segment, passed in `params`.
 * TYPESCRIPT YOU WILL SEE HERE: type aliases, destructured parameters, `instanceof`, `try/catch`,
 *   `as never`, `(row as { id?: number }).id` (assert a shape, then read an optional field).
 */

// `import { a } from "b"` loads named exports from module "b".
// `NextResponse` builds HTTP responses.
import { NextResponse } from "next/server";
// `@fundhub/…` = our shared packages. The database connection.
// `@/…` = this app's src folder. API helpers: login check, error reply, page-of-rows query, table loader,
// URL option parser, and the "keep only editable fields" filter.
import { apiStaff, jsonError, listRows, loadResource, parseListParams, writable, writeTx } from "@/lib/api";
// Audit-log writer.
import { audit } from "@/lib/audit";

/**
 * Kind: type alias. The context Next.js passes to each handler: `params`, a Promise of `{ resource }`.
 */
type Ctx = { params: Promise<{ resource: string }> };

/**
 * Kind: async function — the HTTP GET handler (list rows).
 * @param req     type `Request` — the incoming request; its URL carries ?page=…&sort=…&q=… options.
 * @param second  `{ params }: Ctx` — destructured route context.
 * @returns       `Promise<Response>`: JSON with the rows and the total count, or 401/404.
 */
export async function GET(req: Request, { params }: Ctx) {
  // Either the staff member or a ready-made 401 response.
  const staff = await apiStaff();
  if (staff instanceof NextResponse) return staff;
  // The allowed table named in the URL, or null.
  const r = loadResource((await params).resource);
  if (!r) return jsonError("Unknown resource", 404);
  // `new URL(req.url)` parses the address; `parseListParams` reads the paging/sort/search options from it;
  // `listRows` runs the query. The result is sent as JSON.
  return NextResponse.json(await listRows(r, parseListParams(new URL(req.url))));
}

/**
 * Kind: async function — the HTTP POST handler (create a row).
 * @param req     type `Request` — its JSON body holds the new row's values.
 * @param second  `{ params }: Ctx` — destructured route context.
 * @returns       `Promise<Response>`: `{ data: newRow }` with status 201 ("created"), or an error.
 */
export async function POST(req: Request, { params }: Ctx) {
  const staff = await apiStaff();
  if (staff instanceof NextResponse) return staff;
  const name = (await params).resource;
  const r = loadResource(name);
  if (!r) return jsonError("Unknown resource", 404);
  // Creating must be switched on for this table AND the role must be allowed to write. 403 = forbidden.
  if (!r.def.canCreate || !r.def.write?.includes(staff.role)) return jsonError("Not allowed", 403);
  // `try/catch`: any error below (bad JSON, a value the database refuses) becomes a 400 reply.
  try {
    // Keep only the fields staff may set, converted to the right types.
    const values = writable(r.meta, await req.json());
    // INSERT the row and get it back (`.returning`). `as never` bypasses TypeScript, which cannot know the
    // columns of a table chosen at run time.
    const [row] = await writeTx(r, staff, (d) => d.insert(r.def.table).values(values as never).returning(r.selection));
    // Audit: "create" on this table, with the new id (if the table has one) and the values used.
    await audit(staff, "create", name, (row as { id?: number }).id, values);
    return NextResponse.json({ data: row }, { status: 201 });
  } catch (err) {
    return jsonError(err instanceof Error ? err.message : "Invalid data");
  }
}
