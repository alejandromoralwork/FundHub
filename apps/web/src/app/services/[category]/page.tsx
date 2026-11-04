/**
 * FILE: apps/web/src/app/services/[category]/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The buyer's guide for one service category, e.g. /services/fund-administration. It shows
 *   when you need the service, the typical fee range, the sub-services we index, what to compare, red flags
 *   in proposals, the three top-scored providers, related articles, and a call to talk to an advisor.
 * WHERE IT RUNS: on the server (Node.js), as a React server component that reads the database.
 * FRAMEWORK NOTES:
 *   - page.tsx = a web page; folder path = URL. [category] in square brackets is a "dynamic segment": it
 *     matches any value and Next.js passes it as `params.category`.
 *   - `dynamic = "force-dynamic"`: build the page fresh on every visit (fees and providers change).
 *   - `generateMetadata`: Next.js hook for a <title>/description that depends on the category.
 *   - `notFound()`: show the 404 page for an unknown category.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type alias `type Props = {...}`, `Promise<T>` and `await`.
 *   - `Promise.all` with array destructuring `const [a, b] = await ...`.
 *   - `.find` (first match or undefined), `.slice(0, 3)` (first three items), `.length` (number of items).
 *   - ternary `a ? b : c`, logical `&&`, nullish coalescing `??`, template strings.
 */

// `import { a } from "b"` loads named exports ("next", "lucide-react" = npm libraries; "@/..." = this app's
// src folder; "@fundhub/..." = our shared packages). `import X from "b"` loads the default export.
// Metadata: the Next.js type for page title/description data.
import type { Metadata } from "next";
// Link: Next.js in-site link without a full reload.
import Link from "next/link";
// articleHref(kind, slug): builds an article's address, e.g. "/learn/my-guide".
import { articleHref } from "@/lib/articles";
// notFound: shows the 404 page.
import { notFound } from "next/navigation";
// Lucide icons: warning triangle and left/right arrows.
import { AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
// Our design pieces: ButtonLink (a link styled as a button), CheckList (bullet list), CtaBand
// (call-to-action strip), Panel (bordered box).
import { ButtonLink, CheckList, CtaBand, Panel } from "@/components/marketing";
// ProviderCard: the summary card for one provider (same one used in the comparator).
import { ProviderCard } from "@/components/provider-card";
// Database queries: fee benchmarks per category, published articles, and the provider search.
import { getFeeBenchmarks, listPublishedPosts, searchProviders } from "@fundhub/db/queries";
// parseFilters: turns raw URL-style values into a clean, checked filter object for searchProviders.
import { parseFilters } from "@fundhub/core/filters";
// formatEur: number -> euro text, e.g. 2500 -> "€2,500".
import { formatEur } from "@fundhub/core/format";
// getCategory(slug): the category's details from the shared taxonomy, or undefined if the slug is unknown.
import { getCategory } from "@fundhub/core/taxonomy";

/** Kind: constant (Next.js setting). Render on every request. */
export const dynamic = "force-dynamic";

/** Kind: type alias. Next.js gives the page `params`: a Promise of `{ category: string }` from the URL. */
type Props = { params: Promise<{ category: string }> };

/**
 * Kind: async function (Next.js metadata hook).
 * @param params  the URL's [category] value, as a Promise.
 * @returns       `Promise<Metadata>`: e.g. title "Depositary: buyer's guide" with a description built from
 *                the category summary; or "Category not found" for an unknown slug.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // Look the category up in the shared taxonomy (no database needed).
  const c = getCategory((await params).category);
  return c
    ? { title: `${c.label}: buyer's guide`, description: `${c.short} What to compare, typical fees and red flags.` }
    : { title: "Category not found" };
}

/**
 * Kind: async React component (server component) — the page.
 * @param params  the URL's [category] value, as a Promise.
 * @returns       `Promise<JSX>`: the buyer's guide for that category.
 */
export default async function CategoryGuidePage({ params }: Props) {
  const c = getCategory((await params).category);
  // Unknown category: show the 404 page. From here on TypeScript knows `c` is defined.
  if (!c) notFound();

  // Fetch the fee benchmarks and this category's providers at the same time.
  // parseFilters builds the same filter object the comparator would get from ?category=...&sort=score,
  // so the providers come back best FundHub Score first.
  const [benchmarks, providers] = await Promise.all([
    getFeeBenchmarks(),
    searchProviders(parseFilters({ category: c.slug, sort: "score" })),
  ]);
  // `.find` picks this category's benchmark row from the list (undefined if there is no fee data).
  const b = benchmarks.find((x) => x.category === c.slug);
  // Up to four published articles tagged with this category.
  const related = await listPublishedPosts({ category: c.slug, limit: 4 });
  // JSX components need a capital first letter, so copy the category icon into `Icon` to draw <Icon />.
  const Icon = c.icon;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
      {/* Back link to the list of all categories. */}
      <Link href="/services" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> All categories
      </Link>

      {/* Header card: icon, name and "when you need it" on the left; fee range on the right from medium
          screens up (`md:flex-row`), underneath on phones. */}
      <header className="flex flex-col gap-5 rounded-lg border border-slate-200 bg-white p-5 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-4">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-emerald">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Buyer&apos;s guide</p>
            <h1 className="text-xl font-semibold text-ink">{c.label}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-600">{c.whenNeeded}</p>
          </div>
        </div>
        {/* `b && (...)`: the fee box is only drawn when benchmark data exists for this category.
            avgMin/avgMax = typical range; lowestMin/highestMax = the cheapest and dearest seen in the market. */}
        {b && (
          <div className="shrink-0 md:text-right">
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Typical fee range</p>
            <p className="tnum text-2xl font-semibold text-ink">
              {formatEur(b.avgMin)} – {formatEur(b.avgMax)}
              <span className="text-sm font-normal text-slate-400">/qtr</span>
            </p>
            <p className="tnum text-xs text-slate-500">
              Market spread {formatEur(b.lowestMin)} – {formatEur(b.highestMax)} · {b.providers} providers
            </p>
          </div>
        )}
      </header>

      {/* Three boxes side by side on large screens (`lg:grid-cols-3`, 1024px+). */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Sub-services we index</h2>
          {/* Each sub-service links to the comparator filtered to it; `encodeURIComponent` makes the name
              safe to put in a URL. */}
          <ul className="space-y-1.5">
            {c.services.map((s) => (
              <li key={s}>
                <Link
                  href={`/compare?category=${c.slug}&service=${encodeURIComponent(s)}`}
                  className="flex items-center justify-between gap-2 text-sm text-ink-600 hover:text-ink hover:underline"
                >
                  {s} <ArrowRight className="h-3 w-3 shrink-0 text-slate-400" />
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
        <Panel>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">What to compare</h2>
          {/* `c.compareOn` and `c.redFlags` are text lists stored in the shared taxonomy for each category. */}
          <CheckList items={c.compareOn} />
        </Panel>
        <Panel>
          <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" /> Red flags in proposals
          </h2>
          <CheckList items={c.redFlags} tone="negative" />
          <Link
            href={`/advisory?service=fee-audit#contact`}
            className="mt-4 inline-block text-xs font-medium text-emerald-700 hover:underline"
          >
            Have a proposal? Get it audited independently →
          </Link>
        </Panel>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          {/* `.toLowerCase()` writes the label in small letters to fit the sentence. */}
          <h2 className="text-lg font-semibold text-ink">Top-rated {c.label.toLowerCase()} providers</h2>
          <div className="flex gap-2">
            {/* "Request quotes" pre-fills the RFI form with the category's first sub-service.
                `c.services[0] ?? ""` = the first item, or empty text if the list is empty. */}
            <ButtonLink href={`/rfi?service=${encodeURIComponent(c.services[0] ?? "")}`} variant="outline" className="py-2 text-xs">
              Request quotes
            </ButtonLink>
            <ButtonLink href={`/compare?category=${c.slug}`} className="py-2 text-xs">
              Compare all {providers.length} <ArrowRight className="h-3.5 w-3.5" />
            </ButtonLink>
          </div>
        </div>
        {/* `.slice(0, 3)` keeps only the first three providers (already sorted by score). */}
        <div className="space-y-3">
          {providers.slice(0, 3).map((p) => (
            <ProviderCard key={p.id} provider={p} category={c} />
          ))}
        </div>
      </section>

      {/* "Related reading" appears only if at least one article is tagged with this category. */}
      {related.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-ink">Related reading</h2>
          <div className="grid gap-3 md:grid-cols-2">
            {/* Each article is a clickable card; `line-clamp-2` cuts the summary after two lines. */}
            {related.map((i) => (
              <Link
                key={i.slug}
                href={articleHref(i.kind, i.slug)}
                className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald/50"
              >
                <p className="text-sm font-semibold text-ink">{i.title}</p>
                <p className="mt-1 line-clamp-2 text-xs text-ink-600">{i.summary}</p>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Closing call to action (only a primary button here; `secondary` is optional in CtaBand). */}
      <CtaBand
        title="Not sure what your structure needs?"
        body="Our Fund Set-up Service Map tells you which providers your structure legally requires, realistic budgets and a timeline, with no referrals attached."
        primary={{ href: "/advisory?service=fund-setup#contact", label: "Talk to an advisor" }}
      />
    </main>
  );
}
