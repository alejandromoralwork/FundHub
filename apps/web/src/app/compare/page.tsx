/**
 * FILE: apps/web/src/app/compare/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The provider comparator at /compare, the heart of the website. It reads the search filters
 *   from the URL (category, services, price range, sort order...), searches the provider index in the
 *   database, and shows: a filter bar, four headline stat cards, a side panel of extra filters, an optional
 *   explanation box for the chosen category, the result count, and one card per matching provider.
 * WHERE IT RUNS: on the server (Node.js) as a React server component: all searching happens on the server.
 *   The filter controls (FilterBar, FilterPane, SortSelect...) are client components that run in the browser;
 *   when a visitor changes a filter they update the URL, and Next.js re-runs this page with the new filters.
 * FRAMEWORK NOTES:
 *   - page.tsx inside app/compare/ = the page at /compare. `searchParams` = the URL query string.
 *   - `generateMetadata` is the dynamic version of `metadata`: an async function Next.js calls per request
 *     to build the <head> title/description, here so each category gets its own title in Google.
 *   - `dynamic = "force-dynamic"`: never cache; every request runs a fresh search.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type alias `type Props = {...}` and type-only imports (`type ProviderFilters`).
 *   - `async`/`await`, `Promise<Metadata>`, `Promise.all` with array destructuring.
 *   - `.reduce()` (fold a list into one number), `.filter(Boolean)`, `!!value` (convert to true/false).
 *   - `??`, `||`, `&&`, ternary `c ? a : b`, template strings, fragments `<>...</>`.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next..."/"lucide-react" = npm libraries;
// "@/..." = this app's src folder; "@fundhub/..." = FundHub's shared packages in packages/.
// `Metadata`: type for the page's <head> settings.
import type { Metadata } from "next";
// `Link`: Next.js link that changes page without a full reload.
import Link from "next/link";
// Icons (small SVG-drawing React components).
import { ArrowRight, BadgeCheck, Database, FileSearch, SearchX, TrendingDown } from "lucide-react";
// Filter controls: the top bar (search box, category, services), the side panel, and its phone version.
import { FilterBar } from "@/components/filter-bar";
import { FilterPane } from "@/components/filter-pane";
import { MobileFilters } from "@/components/mobile-filters";
// One provider's result card.
import { ProviderCard } from "@/components/provider-card";
// The "sort by" dropdown.
import { SortSelect } from "@/components/sort-select";
// The row of four headline figure cards.
import { StatCards } from "@/components/stat-cards";
// Database queries: overall stats, number of providers per type (for the filter), and the search itself.
import { getEcosystemStats, getProviderTypeCounts, searchProviders } from "@fundhub/db/queries";
// `parseFilters` validates the raw query string into a clean filters object; the two types describe the
// raw input (`RawSearchParams`) and the clean result (`ProviderFilters`).
import { parseFilters, type ProviderFilters, type RawSearchParams } from "@fundhub/core/filters";
// Number formatters: thousands separators, and percentages with a sign ("+12%").
import { formatNumber, formatPercent } from "@fundhub/core/format";
// `getCategory(slug)` looks up a service category's details; `ServiceCategory` is the type of one category.
import { getCategory, type ServiceCategory } from "@fundhub/core/taxonomy";

// Always render with fresh data from the database.
export const dynamic = "force-dynamic";

/**
 * Kind: type alias. The props Next.js gives this page: `searchParams`, the query string, arriving later
 * (a Promise) as a `RawSearchParams` object (each key maps to text, a list of texts, or nothing).
 */
type Props = { searchParams: Promise<RawSearchParams> };

/**
 * Kind: async function (Next.js `generateMetadata`).
 * Builds the page title and description from the chosen category, e.g. "Compare Fund Administration providers".
 * @param { searchParams }  type `Props` (destructured): the URL query string.
 * @returns  `Promise<Metadata>`: the <head> settings for this request.
 */
export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  // Clean the query string, take its `category` (or "" if none, thanks to `??`) and look it up.
  // `getCategory` returns the category, or `undefined` for "" / unknown values.
  const category = getCategory(parseFilters(await searchParams).category ?? "");
  // A category was chosen: a specific title; otherwise the general one.
  return category
    ? { title: `Compare ${category.label} providers`, description: `${category.short} Independent fee and quality comparison.` }
    : { title: "Compare providers", description: "Independent comparator for Luxembourg fund service providers." };
}

/**
 * Kind: function (helper).
 * Counts how many of the side-panel filters are switched on, for the badge on the phone "Filters" button.
 * @param f  type `ProviderFilters`: the cleaned filters.
 * @returns  `number`: how many side-panel filters are active (0 to 7).
 */
function countSidePaneFilters(f: ProviderFilters) {
  // Build a list of seven true/false answers, one per side-panel filter:
  // price bounds set (`!== undefined` = "has a value"), lists not empty (`.length > 0`),
  // and `!!f.density` (double NOT turns any value into true/false; 0 or undefined become false).
  // `.filter(Boolean)` keeps only the `true` entries, and `.length` counts them.
  return [
    f.min !== undefined || f.max !== undefined,
    f.type.length > 0,
    !!f.density,
    f.reg.length > 0,
    f.asset.length > 0,
    f.licence.length > 0,
    f.stack.length > 0,
  ].filter(Boolean).length;
}

/**
 * Kind: React component (used only on this page).
 * The explanation box shown above the results when a category is chosen: icon, name, short description,
 * the list of things FundHub compares for that category, and a link to the category's buyer's guide.
 * @param { category }  type `ServiceCategory`: the chosen category's details.
 * @returns  JSX for the box.
 */
function CategoryContext({ category }: { category: ServiceCategory }) {
  // Copy the icon component into a capitalised variable so it can be used as a tag: `<Icon />`.
  const Icon = category.icon;
  return (
    <div className="mb-4 rounded-lg border border-slate-200 bg-white p-4">
      {/* Stacked on phones (`flex-col`), side by side from medium screens (`md:flex-row`). */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink-900 text-emerald">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            {/* When a category is chosen this box carries the page's main <h1> heading. */}
            <h1 className="text-sm font-semibold text-ink">{category.label}</h1>
            <p className="text-xs text-ink-600">{category.short}</p>
            <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400">What we compare</p>
            <ul className="mt-1 grid gap-x-5 gap-y-0.5 text-xs text-ink-600 sm:grid-cols-2">
              {/* One bullet per comparison point; the small green dot is an empty <span> styled as a circle. */}
              {category.compareOn.map((c) => (
                <li key={c} className="flex gap-1.5">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-emerald" />
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <Link
          href={`/services/${category.slug}`}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 hover:underline"
        >
          Buyer&apos;s guide <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
    </div>
  );
}

/**
 * Kind: async React component (the page).
 * @param { searchParams }  type `Props` (destructured): the URL query string holding the filters.
 * @returns  Promise of JSX, the comparator page.
 */
export default async function ComparatorPage({ searchParams }: Props) {
  // Turn the raw query string into clean, validated filters (bad values are dropped, not errors).
  const filters = parseFilters(await searchParams);
  // The chosen category's details, or `undefined` when no category filter is set.
  const category = filters.category ? getCategory(filters.category) : undefined;
  // Run the search and the two supporting queries at the same time.
  const [results, stats, typeCounts] = await Promise.all([
    searchProviders(filters),
    getEcosystemStats(),
    getProviderTypeCounts(),
  ]);

  // How the matched set's average fee midpoint compares to the whole market.
  // `.reduce((sum, p) => ..., 0)` walks through the results, starting at 0, adding each provider's midpoint
  // fee ((min + max) / 2); dividing by the count gives the average. With no results it is simply 0.
  const matchedMid = results.length
    ? results.reduce((sum, p) => sum + (p.priceMin + p.priceMax) / 2, 0) / results.length
    : 0;
  // Percentage difference from the market average: e.g. matched 9,000 vs market 10,000 gives -10%.
  // Only computed when both numbers exist (avoids dividing by zero); otherwise 0.
  const deviation = stats.marketAvgMidpoint && results.length ? (matchedMid / stats.marketAvgMidpoint - 1) * 100 : 0;

  // The outer `<>...</>` is a fragment: it returns several sibling blocks without a wrapping HTML tag.
  return (
    <>
      <FilterBar />
      {/* Four headline cards. Each item: label, value text, icon, plus optional `hint` and `accent`.
          `accent: deviation < 0` highlights the card when the matched providers are cheaper than average. */}
      <StatCards
        stats={[
          { label: "Indexed Providers", value: formatNumber(stats.indexedProviders), icon: Database },
          { label: "Active RFIs", value: formatNumber(stats.activeRfis), icon: FileSearch },
          {
            label: "Avg. Fee Deviation",
            value: formatPercent(deviation),
            icon: TrendingDown,
            hint: "Matched set vs. market average",
            accent: deviation < 0,
          },
          { label: "FundHub Verified", value: formatNumber(stats.verifiedProviders), icon: BadgeCheck },
        ]}
      />

      <main className="flex flex-1 items-start">
        {/* Side filter panel, only on extra-large screens (`hidden ... xl:block`). `sticky top-16` keeps it in
            view while the results scroll; it scrolls by itself if taller than the window. */}
        <aside className="hidden w-72 shrink-0 self-stretch border-r border-slate-200 bg-white xl:block">
          <div className="thin-scroll sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto">
            <FilterPane typeCounts={typeCounts} />
          </div>
        </aside>

        <section className="min-w-0 flex-1 p-4 sm:p-6">
          {/* Category explanation box, only when a category is chosen. */}
          {category && <CategoryContext category={category} />}
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {/* Result count, e.g. "12 providers matched for “lux”". `aria-live="polite"` makes screen readers
                announce the new count when filters change. */}
            <p className="text-sm text-ink-600" aria-live="polite">
              <span className="font-semibold text-ink tnum">{results.length}</span>{" "}
              {results.length === 1 ? "provider" : "providers"} matched
              {filters.q && (
                <>
                  {" "}
                  for <span className="font-medium text-ink">“{filters.q}”</span>
                </>
              )}
            </p>
            <div className="flex items-center gap-2">
              {/* Phone/tablet "Filters" button, showing how many side-panel filters are on. */}
              <MobileFilters typeCounts={typeCounts} activeCount={countSidePaneFilters(filters)} />
              <SortSelect />
            </div>
          </div>

          {/* Results list, or an "empty" message when nothing matches. */}
          {results.length ? (
            <div className="space-y-3">
              {results.map((p) => (
                <ProviderCard key={p.id} provider={p} category={category} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <SearchX className="h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-ink">No providers match these parameters</p>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                Widen the price bounds, remove a service or tech-stack filter, or reset all filters to see the full index.
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
