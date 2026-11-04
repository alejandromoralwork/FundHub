/**
 * FILE: apps/web/src/components/article-page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: Shared building blocks for one article page (a News item or a Learn guide). It loads the
 *   article from the database by its URL slug, shows its title, date, reading time, summary and body
 *   (written in Markdown), links to the related service category and ends with a "talk to an advisor" band.
 *   It also produces the page's <title> and description for search engines and social sharing.
 * WHERE IT RUNS: on the server only. There is no `"use client"` line, so this is a server component: it can
 *   read the database directly and only the finished HTML is sent to the browser.
 * FRAMEWORK NOTES: The real pages are app/news/[slug]/page.tsx and app/learn/[slug]/page.tsx. A folder named
 *   `[slug]` is a "dynamic segment": whatever is in that part of the URL arrives as `params.slug`. Those
 *   pages simply call ArticlePage and articleMetadata from here with their own `kind`.
 *   `notFound()` stops rendering and shows the 404 page; `permanentRedirect()` sends the browser to another
 *   URL with a "moved permanently" (308) status, which search engines remember.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases and exported types, union of literals (`"news" | "learn"`).
 *   - `Promise<T>`: a value of type T that arrives later; `async`/`await` to wait for it.
 *   - intersection types (`Props & { kind: PostKind }`): a type that has the fields of both.
 *   - ternary `c ? x : y`, logical `&&`, destructuring with rest (`{ href, ...p }`), spread `{...p}`.
 */

// `import x from "y"` / `import { x } from "y"` pull code from another module. Plain names are npm
// libraries; `@fundhub/...` are our shared packages; `@/...` is this app's src folder.

// `Metadata` is the Next.js type describing a page's <title>, description, social preview, etc.
import type { Metadata } from "next";
// Next.js link component (page change without full reload).
import Link from "next/link";
// Next.js helpers to show the 404 page or to redirect permanently (see header).
import { notFound, permanentRedirect } from "next/navigation";
// Icons: a back arrow and a clock.
import { ArrowLeft, Clock } from "lucide-react";
// react-markdown turns Markdown text (e.g. "## Heading", "**bold**") into React elements.
import Markdown from "react-markdown";
// Looks up a service category (its label and slug) from its id.
import { getCategory } from "@fundhub/core/taxonomy";
// Database query: fetch one published article by slug (returns nothing for drafts or unknown slugs).
import { getPublishedPost } from "@fundhub/db/queries";
// The coloured "call to action" band at the bottom of marketing pages.
import { CtaBand } from "@/components/marketing";
// Builds an article's correct URL from its kind and slug, e.g. "/news/my-article".
import { articleHref } from "@/lib/articles";

/**
 * Kind: type alias. What Next.js passes to a `[slug]` page: `params`, a Promise of `{ slug: string }`.
 * In current Next.js versions params arrive as a Promise, so we must `await` them before reading `.slug`.
 */
type Props = { params: Promise<{ slug: string }> };
/** Kind: exported type alias. Which section an article belongs to: exactly "news" or "learn". */
export type PostKind = "news" | "learn";

/**
 * Kind: async function (used as a page's `generateMetadata`).
 * @param props  `{ params }: Props` — destructures `params` out of the object Next.js passes.
 * @returns `Promise<Metadata>`: title and description for the browser tab, search results and the
 *          "openGraph" preview shown when the link is shared on LinkedIn etc.
 */
export async function articleMetadata({ params }: Props): Promise<Metadata> {
  // `(await params).slug` = wait for params, then read slug; then wait for the database lookup.
  const p = await getPublishedPost((await params).slug);
  // Ternary: if an article was found use its title and summary, otherwise a "not found" title.
  return p ? { title: p.title, description: p.summary, openGraph: { title: p.title, description: p.summary, type: "article" } } : { title: "Article not found" };
}

/**
 * Kind: constant. A reusable date formatter (built into JavaScript, `Intl` = internationalisation) that
 * writes dates the British way, e.g. "18 October 2026". Created once here instead of on every page view.
 */
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** Article page for one section; an article opened under the other section redirects to its own URL. */
/**
 * Kind: async React server component.
 * Props: `Props & { kind: PostKind }` = the usual `params` plus `kind` ("news" or "learn"), which says
 *   which section's URL this page lives under.
 * Returns: `Promise` of JSX (async components may wait for data before returning their markup).
 * Business rule: each article has one proper URL. If a News article is opened under /learn/... (or the
 *   reverse), we redirect to the right section so search engines see no duplicate pages.
 */
export async function ArticlePage({ params, kind }: Props & { kind: PostKind }) {
  // Load the article; unknown or unpublished slugs give no article.
  const article = await getPublishedPost((await params).slug);
  // No article: show the 404 page. `notFound()` never returns, so code below can assume `article` exists.
  if (!article) notFound();
  // Wrong section: send the visitor to the article's real URL.
  if (article.kind !== kind) permanentRedirect(articleHref(article.kind, article.slug));
  // The related service category, if the article has one; `undefined` otherwise.
  const category = article.category ? getCategory(article.category) : undefined;

  return (
    // Tailwind: `mx-auto max-w-3xl` = centred column of limited width; `space-y-8` = vertical gap between
    // children; `p-4 sm:p-6` = padding, a bit larger from small-tablet width up.
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 p-4 sm:p-6">
      {/* Back link to the section index ("/news" or "/learn"), built with a template string. */}
      <Link href={`/${kind}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> {kind === "news" ? "News" : "Learn"}
      </Link>

      {/* The white article card. */}
      <article className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8">
        {/* Small green overline: section and topic, e.g. "NEWS · Regulation". */}
        <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
          {article.kind === "news" ? "News" : "Learn"} · {article.topic}
        </p>
        <h1 className="mt-1 text-2xl font-semibold leading-snug text-ink">{article.title}</h1>
        {/* Date (only if it has one: `a && b` shows b only when a has a value) and reading time. */}
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
          {article.publishedAt && dateFmt.format(article.publishedAt)} · <Clock className="h-3 w-3" /> {article.readMinutes} min read
        </p>
        <p className="mt-5 text-base leading-relaxed text-ink-600">{article.summary}</p>

        {/* Markdown without raw HTML: safe for staff- and AI-written content. */}
        {/* `components={{ ... }}` tells react-markdown which element to use for each Markdown tag, so each
            gets our Tailwind styling. Each entry is an arrow function receiving the tag's props `p` and
            returning e.g. an <h2>; `{...p}` (spread) passes all those props (including its text) through.
            The outer `{ }` is "insert a value", the inner `{ }` is the object itself. */}
        <div className="prose-fh mt-6">
          <Markdown
            components={{
              h2: (p) => <h2 className="mt-6 mb-2 text-lg font-semibold text-ink" {...p} />,
              h3: (p) => <h3 className="mt-5 mb-2 text-base font-semibold text-ink" {...p} />,
              p: (p) => <p className="mb-3 text-sm leading-relaxed text-ink-600" {...p} />,
              ul: (p) => <ul className="mb-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-600" {...p} />,
              ol: (p) => <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-600" {...p} />,
              // Links: `{ href, ...p }` takes out `href` and gathers the rest into `p` (rest destructuring).
              // `rel="noopener noreferrer"` stops the linked site from controlling or tracking our tab.
              a: ({ href, ...p }) => <a href={href} className="font-medium text-emerald-700 underline" rel="noopener noreferrer" {...p} />,
              strong: (p) => <strong className="font-semibold text-ink" {...p} />,
            }}
          >
            {article.body}
          </Markdown>
        </div>

        {/* Related links, only when the article is tied to a service category: its buyer's guide and the
            comparator pre-filtered to that category. `&apos;` writes an apostrophe in JSX text. */}
        {category && (
          <p className="mt-8 border-t border-slate-100 pt-4 text-sm text-ink-600">
            Related:{" "}
            <Link href={`/services/${category.slug}`} className="font-medium text-emerald-700 hover:underline">
              {category.label} buyer&apos;s guide
            </Link>{" "}
            ·{" "}
            <Link href={`/compare?category=${category.slug}`} className="font-medium text-emerald-700 hover:underline">
              Compare providers
            </Link>
          </p>
        )}
        <p className="mt-4 text-[11px] text-slate-400">General information only, not legal, tax or investment advice.</p>
      </article>

      {/* Closing call to action. Props are passed like HTML attributes; `primary={{ ... }}` passes an object. */}
      <CtaBand
        title="Want this applied to your fund?"
        body="Our independent advisors benchmark your providers and proposals against the market, paid only by you."
        primary={{ href: "/advisory#contact", label: "Talk to an advisor" }}
      />
    </main>
  );
}
