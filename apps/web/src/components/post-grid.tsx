/**
 * FILE: apps/web/src/components/post-grid.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: Shows a grid of article cards (for the News and Learn sections). Each card links to the full
 *   article and shows its topic, title, summary, date and reading time. If there are no articles it shows a
 *   dashed "empty" box with a message instead.
 * WHERE IT RUNS: on the server (no "use client" line, so it is a Next.js server component that outputs HTML).
 * FRAMEWORK NOTES: A React component is a function returning JSX (HTML-like markup). Next.js's <Link> is a
 *   smarter <a> link: it moves between pages without a full browser reload. Lists rendered with `.map(…)`
 *   need a unique `key` per item. Tailwind classes in `className` are small styles (`md:` = on wider screens).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type alias `type PostItem = { … }` describing an object's shape.
 *   - union with null `Date | null` = either a date or "no value" (e.g. not yet published).
 *   - array type `PostItem[]`; logical NOT `!` and AND `&&`.
 */

// `import X from "b"` (no braces) imports the file's single "default" export; with braces it picks named ones.
// `next/link` is Next.js's link component.
import Link from "next/link";
// A small clock icon from the `lucide-react` icon library (npm).
import { Clock } from "lucide-react";
// From this app's src/lib/articles.ts: builds an article's URL, "/learn/<slug>" or "/news/<slug>".
import { articleHref } from "@/lib/articles";

/**
 * Kind: constant.
 * A reusable date formatter using the built-in `Intl.DateTimeFormat` with British English ("en-GB"), so
 * dates read like "4 Mar 2026". Created once here, outside the component, so it is not rebuilt every render.
 */
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/**
 * Kind: type alias (exported so pages that load articles can build this shape).
 * One article card's data: slug (URL name), kind ("learn" or news), title, summary, topic label,
 * readMinutes (estimated reading time), publishedAt (`Date | null` — null if it has no publish date).
 */
export type PostItem = { slug: string; kind: string; title: string; summary: string; topic: string; readMinutes: number; publishedAt: Date | null };

/**
 * Kind: React component (server component).
 * Props:
 *   - items  type `PostItem[]` — the articles to show.
 *   - empty  type `string` — the message to show when there are no articles.
 * Returns: JSX — the grid of cards, or the empty-state box.
 */
export function PostGrid({ items, empty }: { items: PostItem[]; empty: string }) {
  // `items.length` is the number of articles; `!0` is true, so this runs when the list is empty.
  // Early return of the dashed, centred message box.
  if (!items.length) return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    // One column on phones, two columns from medium screens up (`md:grid-cols-2`), with a gap between cards.
    <div className="grid gap-4 md:grid-cols-2">
      {/* `.map((i) => …)` turns each article `i` into a card. The whole card is one clickable <Link>. */}
      {items.map((i) => (
        <Link
          // The slug is unique per article, so it serves as the list `key`.
          key={i.slug}
          href={articleHref(i.kind, i.slug)}
          // `flex flex-col` stacks the contents vertically; `hover:` classes tint the border and add a shadow
          // when the mouse is over the card. `emerald/50` = emerald at 50% opacity.
          className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 hover:border-emerald/50 hover:shadow-sm"
        >
          {/* Small upper-case green topic label. `text-[10px]` = an exact custom size in square brackets. */}
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{i.topic}</p>
          <h2 className="mt-1 text-base font-semibold text-ink">{i.title}</h2>
          {/* `flex-1` makes the summary stretch, pushing the date line to the bottom so cards line up. */}
          <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-600">{i.summary}</p>
          {/* Footer line: date (only if there is one — `a && b`), a dot, the clock icon and reading time. */}
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
            {i.publishedAt && dateFmt.format(i.publishedAt)} · <Clock className="h-3 w-3" /> {i.readMinutes} min read
          </p>
        </Link>
      ))}
    </div>
  );
}
