/**
 * FILE: apps/admin/src/app/(console)/db/[resource]/[id]/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The page for editing one database record (or creating a new one) in the Console's database
 *   browser, e.g. /admin/db/providers/17 edits provider 17 and /admin/db/providers/create adds a new one.
 *   It only checks that the table name is one we allow, then hands over to the edit form component.
 * WHERE IT RUNS: on the server (Node.js) as a server component; the ResourceEdit form it renders runs in the
 *   browser and loads/saves the record itself through the Console's /api/resources routes.
 * FRAMEWORK NOTES: folders in square brackets are "dynamic segments": "[resource]" and "[id]" match any text
 *   in those parts of the URL and Next.js passes them in `params`. The login check is not repeated here
 *   because the shared (console)/layout.tsx already runs `requireStaff()` for every page in this group.
 * TYPESCRIPT YOU WILL SEE HERE: object destructuring (`const { a, b } = obj`), inline object types,
 *   `Promise<…>`, ternary `c ? x : y`, `undefined`, `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// `notFound()` (Next.js) stops rendering and shows the 404 page.
import { notFound } from "next/navigation";
// `@/…` = this app's src folder. ResourceEdit is the edit/create form (built with Refine + Ant Design).
import { ResourceEdit } from "@/components/db-views";
// `getResource(name)` returns the settings of an allowed table, or undefined if the name is not allowed.
import { getResource } from "@/lib/resources";

/**
 * Kind: React component (async server component) — the page.
 * @param props  `{ params }` destructures the object Next.js passes in. `params` is a Promise (arrives later)
 *               of `{ resource: string; id: string }`: the table key and record id taken from the URL.
 * @returns `Promise<JSX>`: the edit form markup.
 */
export default async function ResourceRecordPage({ params }: { params: Promise<{ resource: string; id: string }> }) {
  // Wait for the URL values and unpack them into two constants (object destructuring).
  const { resource, id } = await params;
  // Unknown table name in the URL: show 404 instead of an empty form.
  if (!getResource(resource)) notFound();
  // The special id "create" means "new record", which the form signals by having no id (`undefined`).
  return <ResourceEdit resource={resource} id={id === "create" ? undefined : id} />;
}
