/**
 * FILE: apps/web/src/app/learn/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The /learn page: a list (grid of cards) of every published "Learn" guide, with a small box at
 *   the bottom pointing readers to the Data Intelligence statistics.
 * WHERE IT RUNS: on the server (Node.js). It is a React server component, so it can read the database
 *   directly; the browser only receives finished HTML.
 * FRAMEWORK NOTES: In the Next.js App Router, a file called page.tsx inside app/ is a web page and its folder
 *   path is the URL (app/learn/page.tsx -> /learn). Exporting `metadata` sets the page's <title> and
 *   description; exporting `dynamic = "force-dynamic"` makes Next.js rebuild the page on every visit so
 *   newly published guides show up at once.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type`: import only a type, which vanishes when compiled.
 *   - type annotation `metadata: Metadata`: the object must match Next.js's Metadata shape.
 *   - async/await: wait for the database before drawing.
 *   - object literal `{ kind: "learn" }`: a small object passed as the function's options.
 */

// `import { a } from "b"` loads the named export `a` from module "b". Plain names ("next", "lucide-react")
// are npm libraries; "@/..." is this app's src folder; "@fundhub/..." is one of our own shared packages.
// Metadata: the Next.js type for the `metadata` export.
import type { Metadata } from "next";
// Link: Next.js's version of an <a> link; it moves between our own pages without a full page reload.
import Link from "next/link";
// BarChart3: a bar-chart icon from the Lucide icon library (drawn as an inline SVG image).
import { BarChart3 } from "lucide-react";
// Panel (a bordered box) and SectionTitle (heading with small "eyebrow" label and intro text): our design pieces.
import { Panel, SectionTitle } from "@/components/marketing";
// PostGrid: draws a list of articles as cards, or an "empty" message if there are none.
import { PostGrid } from "@/components/post-grid";
// listPublishedPosts: database query (shared db package) returning published news/learn articles.
import { listPublishedPosts } from "@fundhub/db/queries";

/** Kind: constant (Next.js setting). Render on every request, so new guides appear immediately. */
export const dynamic = "force-dynamic";
/** Kind: constant (Next.js metadata). Tab title becomes "Learn · FundHub" via the root layout's template. */
export const metadata: Metadata = {
  title: "Learn",
  description: "Independent guides on choosing Luxembourg fund service providers, reading fee proposals and structuring your fund.",
};

/**
 * Kind: async React component (server component) — the /learn page.
 * Takes no parameters.
 * @returns `Promise<JSX>`: the page markup, ready once the guides have been read from the database.
 */
export default async function LearnPage() {
  // Ask the database for published articles of kind "learn" only (news articles are left out).
  const items = await listPublishedPosts({ kind: "learn" });
  // The JSX below is the page. `className` holds Tailwind CSS utility classes, each a tiny style rule:
  // `mx-auto` centres horizontally, `max-w-5xl` caps the width, `flex-1` fills spare height, `space-y-6` puts
  // a gap between children, `p-4 sm:p-6` = padding 1rem, or 1.5rem on screens at least "small" (640px) wide.
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      {/* Page heading. `as="h1"` tells SectionTitle to use the main heading tag (good for search engines). */}
      <SectionTitle
        as="h1"
        eyebrow="Learn"
        title="Guides for fund buyers"
        lead="Practical, independent guides: choosing providers, reading fee proposals, negotiating, and structuring your fund's service chain in Luxembourg."
      />
      {/* The grid of guide cards; `{items}` passes the JavaScript value (the array) as a prop. */}
      <PostGrid items={items} empty="No guides published yet." />
      {/* A dashed box: stacked on phones (`flex-col`), side by side from small screens up (`sm:flex-row`). */}
      <Panel className="flex flex-col gap-3 border-dashed sm:flex-row sm:items-center">
        <BarChart3 className="h-8 w-8 shrink-0 text-emerald" />
        <div>
          <h2 className="text-sm font-semibold text-ink">Want the numbers behind the guides?</h2>
          <p className="mt-0.5 text-sm text-ink-600">
            {/* `{" "}` inserts a real space: JSX drops spaces at the end of a line before a new tag. */}
            Live statistics and quarterly reports are in{" "}
            <Link href="/data-intelligence" className="font-medium text-emerald-700 hover:underline">
              Data Intelligence
            </Link>
            .
          </p>
        </div>
      </Panel>
    </main>
  );
}
