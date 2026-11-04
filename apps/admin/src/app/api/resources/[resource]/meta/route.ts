/**
 * FILE: apps/admin/src/app/api/resources/[resource]/meta/route.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: A JSON API that describes one browsable database table for the Console's database screens:
 *   its label, its columns (and which ones THIS staff member may edit), which columns can be searched, and
 *   whether they may create, delete or edit records. The screens use it to build their tables and forms.
 * WHERE IT RUNS: on the server (Node.js) only; called by the browser at /admin/api/resources/<table>/meta.
 * FRAMEWORK NOTES: a route.ts file is an API endpoint; exporting a function named GET makes it answer
 *   HTTP GET requests. "[resource]" is a dynamic URL segment passed in `params`. The fixed folder "meta"
 *   wins over the neighbouring "[id]" folder, so /…/providers/meta reaches this file, not the record route.
 * TYPESCRIPT YOU WILL SEE HERE: destructured parameters with inline types, `instanceof`, `!!x`, `&&`,
 *   object spread `{ ...m, editable }`, `??`.
 */

// `import { a } from "b"` loads named exports from module "b".
// `NextResponse` builds HTTP responses (here: JSON).
import { NextResponse } from "next/server";
// `@/…` = this app's src folder. API login check, error reply helper, and table loader.
import { apiStaff, jsonError, loadResource } from "@/lib/api";

/**
 * Kind: async function — the HTTP GET handler.
 * @param _req    type `Request` — unused (the leading underscore marks it as deliberately ignored).
 * @param second  `{ params }` destructured; a Promise of `{ resource: string }` (the table key from the URL).
 * @returns       `Promise<Response>`: the table description as JSON, or 401/404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ resource: string }> }) {
  // Either the staff member or a ready-made 401 "Not authenticated" response.
  const staff = await apiStaff();
  if (staff instanceof NextResponse) return staff;
  // Look up the table named in the URL.
  const r = loadResource((await params).resource);
  if (!r) return jsonError("Unknown resource", 404);
  // May this person write to this table at all? (`!!` turns undefined into false.)
  const canWrite = !!r.def.write?.includes(staff.role);
  // Reply with the description. Each permission is combined with `canWrite` using `&&` ("and").
  return NextResponse.json({
    label: r.def.label,
    // Copy each column's description (`...m`) but override `editable`: only editable if the person can write.
    columns: r.meta.map((m) => ({ ...m, editable: canWrite && m.editable })),
    // Searchable columns, or an empty list if none are set.
    search: r.def.search ?? [],
    canCreate: canWrite && !!r.def.canCreate,
    canDelete: canWrite && !!r.def.canDelete,
    // Editing one record needs an "id" column to address it.
    canEdit: canWrite && r.hasId,
  });
}
