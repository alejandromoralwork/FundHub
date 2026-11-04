/**
 * FILE: apps/web/src/app/news/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The /news page: a grid of every published news article, with a small box at the bottom
 *   pointing readers to the Learn guides.
 * WHERE IT RUNS: on the server (Node.js). It is a React server component, so it can read the database
 *   directly; the browser only receives finished HTML.
 * FRAMEWORK NOTES: In the Next.js App Router, a file called page.tsx inside app/ is a web page and its folder
 *   path is the URL (app/news/page.tsx -> /news). Exporting `metadata` sets the <title> and description;
 *   `dynamic = "force-dynamic"` makes Next.js rebuild the page on every visit so new articles appear at once.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type`: import only a type, which vanishes when compiled.
 *   - type annotation `metadata: Metadata`: the object must match Next.js's Metadata shape.
 *   - async/await: wait for the database before drawing.
 */

// `import { a } from "b"` loads the named export `a` from module "b". Plain names ("next", "lucide-react")
// are npm libraries; "@/..." is this app's src folder; "@fundhub/..." is one of our own shared packages.
// Metadata: the Next.js type for the `metadata` export.
import type { Metadata } from "next";
// Link: Next.js's version of an <a> link; moves between our pages without a full reload.
import Link from "next/link";
// BookOpen: an open-book icon from the Lucide icon library.
import { BookOpen } from "lucide-react";
// Panel (bordered box) and SectionTitle (heading with eyebrow label and intro text): our design pieces.
import { Panel, SectionTitle } from "@/components/marketing";
// PostGrid: draws articles as cards, or an "empty" message when there are none.
import { PostGrid } from "@/components/post-grid";
// listPublishedPosts: database query returning published news/learn articles.
import { listPublishedPosts } from "@fundhub/db/queries";

/** Kind: constant (Next.js setting). Render on every request, never serve a cached copy. */
export const dynamic = "force-dynamic";
/** Kind: constant (Next.js metadata). Tab title becomes "News · FundHub" via the root layout's template. */
export const metadata: Metadata = {
  title: "News",
  description: "News about the Luxembourg fund services sector: regulation, market moves and FundHub announcements.",
};

/**
 * Kind: async React component (server component) — the /news page.
 * Takes no parameters.
 * @returns `Promise<JSX>`: the page markup, ready once the articles have been read from the database.
 */
export default async function NewsPage() {
  // Ask the database for published articles of kind "news" only.
  const items = await listPublishedPosts({ kind: "news" });
  // Tailwind classes: `mx-auto` centre, `max-w-5xl` max width, `space-y-6` vertical gaps between children,
  // `p-4 sm:p-6` padding that grows on screens 640px and wider (the `sm:` prefix).
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      {/* Page heading; `as="h1"` makes it the main heading tag of the page. */}
      <SectionTitle
        as="h1"
        eyebrow="News"
        title="Luxembourg fund services news"
        lead="What's changing in the sector: regulation, market moves, provider news and FundHub announcements. Written for buyers, never sponsored by providers."
      />
      {/* The grid of article cards. */}
      <PostGrid items={items} empty="No news published yet." />
      {/* Dashed cross-link box: stacked on phones, side by side from small screens (`sm:flex-row`). */}
      <Panel className="flex flex-col gap-3 border-dashed sm:flex-row sm:items-center">
        <BookOpen className="h-8 w-8 shrink-0 text-emerald" />
        <div>
          <h2 className="text-sm font-semibold text-ink">Looking for practical guides?</h2>
          <p className="mt-0.5 text-sm text-ink-600">
            {/* `{" "}` keeps a space before the link; JSX would otherwise drop it at the line break. */}
            How to choose providers, read fee proposals and structure your service chain:{" "}
            <Link href="/learn" className="font-medium text-emerald-700 hover:underline">
              Learn
            </Link>
            .
          </p>
        </div>
      </Panel>
    </main>
  );
}
