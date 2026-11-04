/**
 * FILE: apps/admin/src/app/api/resources/[resource]/[id]/route.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The JSON API for ONE database record in the Console's database browser. It answers three
 *   kinds of request on /admin/api/resources/<table>/<id>: GET (read the record), PATCH (change some of its
 *   fields) and DELETE (remove it). Every change is written to the audit log with a before/after record.
 * WHERE IT RUNS: on the server (Node.js) only. The browser's edit form (Refine's data provider) calls it.
 * FRAMEWORK NOTES: Next.js treats a file called route.ts inside app/ as an API endpoint instead of a page.
 *   The functions it exports are named after HTTP methods (GET, POST, PATCH, DELETE…); Next.js calls the one
 *   matching the request. Folders in square brackets ("[resource]", "[id]") are dynamic segments whose values
 *   arrive in `ctx.params`. With the Console's basePath the URL starts /admin/api/….
 * TYPESCRIPT YOU WILL SEE HERE: type aliases (`type Ctx = …`), `instanceof`, `as const` (make an object
 *   read-only with exact literal types), the `in` operator as a type check (`"error" in s`), `try/catch`,
 *   unused parameters named with a leading underscore (`_req`), `Record<string, unknown>`, `.filter/.map`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Drizzle ORM helper: `eq(a, b)` = SQL "a = b".
import { eq } from "drizzle-orm";
// `NextResponse` builds HTTP responses; `NextResponse.json(x)` sends x as JSON.
import { NextResponse } from "next/server";
// `@fundhub/…` = our shared packages. The database connection.
// `@/…` = this app's src folder. Shared API helpers:
// apiStaff = login check for APIs (returns a 401 response instead of redirecting); jsonError = error reply;
// loadResource = settings + columns of an allowed table; writable = keep only fields staff may change.
import { apiStaff, jsonError, loadResource, writable, writeTx } from "@/lib/api";
// Writes an entry to the audit log.
import { audit } from "@/lib/audit";

/**
 * Kind: type alias.
 * The second argument Next.js gives each handler: `params`, a Promise of the two URL values.
 * `{ resource: string; id: string }` = an object with two text fields.
 */
type Ctx = { params: Promise<{ resource: string; id: string }> };

/**
 * Kind: async function (private to this file).
 * The checks shared by GET, PATCH and DELETE: logged in? known table with an id column? valid numeric id?
 * @param ctx  type `Ctx` — the route context from Next.js.
 * @returns    either `{ error: <response to send> }` or everything the handler needs:
 *             `{ staff, r, resource, id, where }`. `as const` freezes each object so TypeScript knows
 *             exactly which of the two shapes was returned (a "discriminated" result).
 */
async function setup(ctx: Ctx) {
  // `apiStaff()` returns either the staff member or a ready-made 401 response.
  const staff = await apiStaff();
  // `instanceof NextResponse` = "is this value a response object?" If so, pass it on as the error.
  if (staff instanceof NextResponse) return { error: staff } as const;
  // Wait for the URL values and unpack them.
  const { resource, id } = await ctx.params;
  // Look up the table; null if it is not one we allow.
  const r = loadResource(resource);
  // Unknown table, or a table without an "id" column (records cannot be addressed one by one): 404.
  if (!r || !r.hasId) return { error: jsonError("Unknown resource", 404) } as const;
  // Convert the id text to a number and reject anything that is not a whole number (400, the default).
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) return { error: jsonError("Invalid id") } as const;
  // `where` is the ready-built condition "id = <numericId>"; `r.cols.id!` = the id column (surely present).
  return { staff, r, resource, id: numericId, where: eq(r.cols.id!, numericId) } as const;
}

/**
 * Kind: async function — the HTTP GET handler (read one record).
 * @param _req  type `Request` — the incoming request; unused here (the underscore says so).
 * @param ctx   type `Ctx` — gives the URL values.
 * @returns     `Promise<Response>`: `{ data: row }` as JSON, or a 404 error.
 */
export async function GET(_req: Request, ctx: Ctx) {
  const s = await setup(ctx);
  // `"error" in s` checks whether `s` has an `error` field; TypeScript then knows which shape `s` is.
  if ("error" in s) return s.error;
  // SELECT the allowed columns WHERE id = … LIMIT 1; `[row]` takes the first result (or undefined).
  const [row] = await s.r.db.select(s.r.selection).from(s.r.def.table).where(s.where).limit(1);
  // Ternary: found -> send it; not found -> 404.
  return row ? NextResponse.json({ data: row }) : jsonError("Not found", 404);
}

/**
 * Kind: async function — the HTTP PATCH handler (update some fields of one record).
 * @param req  type `Request` — its JSON body holds the new field values.
 * @param ctx  type `Ctx` — gives the URL values.
 * @returns    `Promise<Response>`: `{ data: updatedRow }`, or an error (403/404/400).
 */
export async function PATCH(req: Request, ctx: Ctx) {
  const s = await setup(ctx);
  if ("error" in s) return s.error;
  // Only roles listed in this table's `write` setting may change it. `?.` handles tables with no `write`
  // setting at all (then the result is undefined, which counts as "not allowed"). 403 = forbidden.
  if (!s.r.def.write?.includes(s.staff.role)) return jsonError("Not allowed", 403);
  // `try { … } catch (err) { … }`: if anything inside `try` throws an error (bad JSON, a value the database
  // rejects…), jump to `catch` and reply with a 400 instead of crashing.
  try {
    // Read the JSON body and keep only editable fields, converted to the right types.
    const values = writable(s.r.meta, await req.json());
    // `Object.keys(values).length` = number of fields; 0 means nothing to do.
    if (!Object.keys(values).length) return jsonError("Nothing to update");
    // Read the record as it is now, for the audit log's "from" values.
    const [before] = await s.r.db.select(s.r.selection).from(s.r.def.table).where(s.where);
    if (!before) return jsonError("Not found", 404);
    // UPDATE … SET <values> WHERE id = … and return the updated row (`.returning(...)`).
    // `values as never` sidesteps TypeScript, which cannot know the columns of a table chosen at run time.
    const [row] = await writeTx(s.r, s.staff, (d) => d.update(s.r.def.table).set(values as never).where(s.where).returning(s.r.selection));
    // Build `{ field: { from, to } }` for the fields that really changed:
    // - `.filter(...)` keeps fields whose before/after values differ (compared as JSON text, which also
    //   works for dates and lists);
    // - `.map(...)` turns each into a [field, { from, to }] pair; `Object.fromEntries` makes the object.
    // `(before as Record<string, unknown>)[k]` reads a field whose name is held in the variable k.
    const changes = Object.fromEntries(
      Object.keys(values)
        .filter((k) => JSON.stringify((before as Record<string, unknown>)[k]) !== JSON.stringify((row as Record<string, unknown>)[k]))
        .map((k) => [k, { from: (before as Record<string, unknown>)[k], to: (row as Record<string, unknown>)[k] }]),
    );
    // Record who changed what.
    await audit(s.staff, "update", s.resource, s.id, changes);
    return NextResponse.json({ data: row });
  } catch (err) {
    // `err instanceof Error` = a proper error object with a message; otherwise use a generic message.
    return jsonError(err instanceof Error ? err.message : "Invalid data");
  }
}

/**
 * Kind: async function — the HTTP DELETE handler (remove one record).
 * @param _req  type `Request` — unused.
 * @param ctx   type `Ctx` — gives the URL values.
 * @returns     `Promise<Response>`: `{ data: deletedRow }`, or an error.
 */
export async function DELETE(_req: Request, ctx: Ctx) {
  const s = await setup(ctx);
  if ("error" in s) return s.error;
  // Deleting must be switched on for this table (`canDelete`) AND the role must be allowed to write.
  if (!s.r.def.canDelete || !s.r.def.write?.includes(s.staff.role)) return jsonError("Not allowed", 403);
  // DELETE … WHERE id = … and get the removed row back.
  const [row] = await writeTx(s.r, s.staff, (d) => d.delete(s.r.def.table).where(s.where).returning(s.r.selection));
  if (!row) return jsonError("Not found", 404);
  // Keep a full copy of the deleted record in the audit log, so it could be restored by hand.
  await audit(s.staff, "delete", s.resource, s.id, { deleted: row });
  return NextResponse.json({ data: row });
}
