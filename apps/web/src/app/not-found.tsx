/**
 * FILE: apps/web/src/app/not-found.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "404 – Page not found" screen. It is shown when someone visits an address that does not
 *   exist, or when a page calls Next.js's `notFound()` (e.g. a provider slug that is not in the database).
 * WHERE IT RUNS: on the server (Node.js), as a React server component; the browser receives plain HTML.
 * FRAMEWORK NOTES: not-found.tsx is a special Next.js App Router file name. Next.js uses it automatically for
 *   missing pages and sends the HTTP status 404. Being at the top of app/, it covers the whole website, and it
 *   is shown inside the root layout (so the header and footer still appear).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - a function component returning JSX (HTML-like markup); no parameters, so no types needed.
 */

// `import X from "y"` loads the module's default export. Link is Next.js's in-site link component
// (like <a>, but it switches pages without reloading the whole site).
import Link from "next/link";

/**
 * Kind: React component (server component) — the 404 page. `export default` is what Next.js looks for.
 * Takes no parameters.
 * @returns JSX: a centred message with a button back to the comparator.
 */
export default function NotFound() {
  // Tailwind classes: `flex flex-col items-center justify-center` stacks the children and centres them
  // both ways; `text-center` centres the text; `p-10` adds generous padding.
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-10 text-center">
      <p className="font-mono text-sm text-emerald-700">404</p>
      <h1 className="mt-2 text-xl font-semibold text-ink">Page not found</h1>
      {/* `&apos;` is the HTML code for an apostrophe; React's linter asks for it inside text. */}
      <p className="mt-1 text-sm text-ink-600">This provider or page isn&apos;t in the index.</p>
      {/* A link styled as a dark button (`bg-ink-900`), slightly lighter on mouse hover (`hover:bg-ink-800`). */}
      <Link href="/compare" className="mt-5 rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800">
        Back to comparator
      </Link>
    </main>
  );
}
