/**
 * FILE: apps/admin/src/app/(console)/db/[resource]/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The page listing the rows of one database table in the Console's database browser,
 *   e.g. /admin/db/providers. It checks the table name is one we allow and renders the list component.
 * WHERE IT RUNS: on the server (Node.js) as a server component; the ResourceList table runs in the browser
 *   and fetches its rows page by page from the Console's /api/resources/[resource] route.
 * FRAMEWORK NOTES: "[resource]" in square brackets is a dynamic segment: it matches any text in that part of
 *   the URL, and Next.js passes it as `params.resource`. Login is enforced by (console)/layout.tsx.
 * TYPESCRIPT YOU WILL SEE HERE: object destructuring, inline object types, `Promise<…>`, `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// `notFound()` (Next.js) shows the 404 page.
import { notFound } from "next/navigation";
// `@/…` = this app's src folder. The table component (built with Refine + Ant Design).
import { ResourceList } from "@/components/db-views";
// Looks up an allowed table by its key; undefined if not allowed.
import { getResource } from "@/lib/resources";

/**
 * Kind: React component (async server component) — the page.
 * @param props  `{ params }` destructured; `params` is a Promise of `{ resource: string }`, the table key from the URL.
 * @returns `Promise<JSX>`: the list markup.
 */
export default async function ResourcePage({ params }: { params: Promise<{ resource: string }> }) {
  // Wait for the URL values and take `resource` out of them.
  const { resource } = await params;
  // Not an allowed table: 404.
  if (!getResource(resource)) notFound();
  // Render the list for that table.
  return <ResourceList resource={resource} />;
}
