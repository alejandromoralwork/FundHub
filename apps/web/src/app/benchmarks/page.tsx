/**
 * FILE: apps/web/src/app/benchmarks/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "Fee Benchmarks & Rankings" page at /benchmarks. It shows three things built from live
 *   database figures: a table of typical quarterly fees per service category (with a small bar chart of the
 *   spread), the top 5 providers per category by FundHub Score (plus the "best value" pick), and a table of
 *   fees per provider type.
 * WHERE IT RUNS: on the server (Node.js) as a React server component, because it reads the database. No part
 *   of it is interactive, so no browser code is needed.
 * FRAMEWORK NOTES: page.tsx inside app/benchmarks/ = the page at /benchmarks. `metadata` sets the tab title
 *   and search description. `dynamic = "force-dynamic"` rebuilds the page per request so figures are current.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Record<string, string>`: a generic type meaning "an object whose keys and values are all strings".
 *   - spread into a function call `Math.max(...list)`; `Promise.all` with array destructuring.
 *   - template strings used to build class names, URLs and CSS percentages.
 *   - the inline `style={{ ... }}` prop, `??` (nullish coalescing), `.toFixed()`, `encodeURIComponent()`.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next..." = npm library;
// "@fundhub/..." = FundHub's shared packages in packages/.
// `Metadata`: type for the page's <head> settings.
import type { Metadata } from "next";
// `Link`: Next.js link that changes page without a full reload.
import Link from "next/link";
// Database queries: fee stats per category and per provider type, overall stats, and top-N rankings.
import { getCategoryRankings, getEcosystemStats, getFeeBenchmarks, getFeeBenchmarksByType } from "@fundhub/db/queries";
// Number formatters: euros ("€12,000") and plain numbers with thousands separators.
import { formatEur, formatNumber } from "@fundhub/core/format";
// Turns a category code into its display label.
import { categoryLabel } from "@fundhub/core/taxonomy";

// Rebuild on every request (see FRAMEWORK NOTES).
export const dynamic = "force-dynamic";
/** Kind: constant (Next.js page metadata): tab title and the summary shown in search results. */
export const metadata: Metadata = {
  title: "Fee Benchmarks & Rankings",
  description: "Typical quarterly fees per Luxembourg fund service category, and provider rankings by FundHub Score.",
};

/**
 * Kind: constant (lookup table) of type `Record<string, string>`.
 * Background colour (Tailwind class) for each FundHub Score grade badge, from green (A+) to grey (D).
 */
const GRADE_STYLE: Record<string, string> = { "A+": "bg-emerald", A: "bg-emerald-600", B: "bg-sky-600", C: "bg-amber-500", D: "bg-slate-400" };

/**
 * Kind: constants (strings of Tailwind classes). Shared styles for table header cells (`th`) and data cells
 * (`td`), stored once so every cell looks the same and the markup below stays short.
 */
const th = "px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const td = "px-4 py-3 tnum";

/**
 * Kind: async React component (the page).
 * Parameters: none.
 * Returns: Promise of JSX, the page markup.
 */
export default async function BenchmarksPage() {
  // Run all four database queries at once and name the results (same order as the list).
  // `getCategoryRankings(5)` = the top 5 providers in each category.
  const [byCategory, byType, stats, rankings] = await Promise.all([
    getFeeBenchmarks(),
    getFeeBenchmarksByType(),
    getEcosystemStats(),
    getCategoryRankings(5),
  ]);
  // The highest fee across all categories, used as the right-hand end (100%) of every bar chart so the bars
  // are comparable. `...` spreads the list of numbers into separate arguments of `Math.max`. The extra `1`
  // guarantees a value of at least 1, avoiding a division by zero when there is no data.
  const scaleMax = Math.max(...byCategory.map((b) => b.highestMax), 1);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
      {/* Page heading and the market-wide headline figures. */}
      <div>
        <h1 className="text-xl font-semibold text-ink">Fee Benchmarks & Rankings</h1>
        <p className="mt-1 text-sm text-ink-600">
          Empirical quarterly fee ranges across {formatNumber(stats.indexedProviders)} indexed providers. Market average
          midpoint: <span className="tnum font-medium text-ink">{formatEur(stats.marketAvgMidpoint)}</span>/qtr.
        </p>
      </div>

      {/* Table 1: fees per category. `overflow-hidden` clips the table to the card's rounded corners. */}
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-ink">Fees by macro-category</h2>
        {/* `overflow-x-auto` + `min-w-[720px]`: on narrow phones the table keeps its width and can be scrolled
            sideways instead of being squashed. */}
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-canvas">
              <tr>
                {/* `className={th}` uses the shared header style constant defined above. */}
                <th className={th}>Category</th>
                <th className={th}>Providers</th>
                <th className={th}>Typical range (avg. min – avg. max)</th>
                {/* A template string adds `w-1/3` (one third of the width) to the shared style. */}
                <th className={`${th} w-1/3`}>Full spread</th>
                <th className={th}>Avg. peer rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {/* One table row per category. */}
              {byCategory.map((b) => (
                <tr key={b.category}>
                  <td className="px-4 py-3 font-medium">
                    {/* Clicking a category opens the Compare page filtered to it. */}
                    <Link href={`/compare?category=${b.category}`} className="hover:underline">
                      {categoryLabel(b.category)}
                    </Link>
                  </td>
                  <td className={td}>{b.providers}</td>
                  <td className={`${td} font-medium`}>
                    {formatEur(b.avgMin)} – {formatEur(b.avgMax)}
                  </td>
                  <td className="px-4 py-3">
                    {/* Bar: full spread in light, typical range in emerald. */}
                    {/* How it works: a grey track (`relative`) holds two bars placed with `absolute`. Their
                        `left` and `width` are set with the `style` prop (an object of CSS properties, hence
                        the double braces `{{ }}`) as percentages of `scaleMax`. E.g. a fee of half of
                        scaleMax starts 50% along. `aria-hidden` hides the drawing from screen readers,
                        since the same numbers are written out below it. */}
                    <div className="relative h-2 rounded-full bg-slate-100" aria-hidden>
                      <div
                        className="absolute inset-y-0 rounded-full bg-slate-300"
                        style={{
                          left: `${(b.lowestMin / scaleMax) * 100}%`,
                          width: `${((b.highestMax - b.lowestMin) / scaleMax) * 100}%`,
                        }}
                      />
                      <div
                        className="absolute inset-y-0 rounded-full bg-emerald"
                        style={{
                          left: `${(b.avgMin / scaleMax) * 100}%`,
                          width: `${((b.avgMax - b.avgMin) / scaleMax) * 100}%`,
                        }}
                      />
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400 tnum">
                      {formatEur(b.lowestMin)} – {formatEur(b.highestMax)}
                    </p>
                  </td>
                  {/* Average rating with two decimals, e.g. 4.37. */}
                  <td className={td}>{b.avgRating.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Rankings: one card per category with its top 5 providers. `id="rankings"` allows /benchmarks#rankings. */}
      <section id="rankings" className="scroll-mt-20 space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">Rankings by FundHub Score</h2>
            <p className="text-sm text-ink-600">Top providers per category. Best value = highest Price Score among providers with a Quality Score of 60 or more.</p>
          </div>
          <Link href="/fundhub-score" className="text-xs font-medium text-emerald-700 hover:underline">
            How the FundHub Score works →
          </Link>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {rankings.map((r) => (
            <div key={r.category} className="rounded-lg border border-slate-200 bg-white">
              {/* Card header: category name (links to Compare, sorted by score) and its provider count. */}
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                <Link href={`/compare?category=${r.category}&sort=score`} className="text-sm font-semibold text-ink hover:underline">
                  {categoryLabel(r.category)}
                </Link>
                <span className="text-[11px] text-slate-400">{r.providers} providers</span>
              </div>
              <ol className="divide-y divide-slate-100">
                {/* One row per top provider. `i` is the position in the list (0, 1, ...), so `i + 1` is the rank. */}
                {r.top.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="tnum w-4 text-xs text-slate-400">{i + 1}</span>
                    <Link href={`/providers/${p.slug}`} className="min-w-0 flex-1 truncate font-medium text-ink hover:underline">
                      {p.name}
                    </Link>
                    {/* Quality and Price sub-scores; hidden on phones (`hidden sm:inline`). The Price score can
                        be missing (no fee data), so `?? "n/a"` shows "n/a" instead. */}
                    <span className="tnum hidden text-[11px] text-slate-400 sm:inline">
                      Q {p.score.quality} · P {p.score.price ?? "n/a"}
                    </span>
                    {/* Grade badge coloured from the GRADE_STYLE table, then the overall FundHub Score. */}
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold text-white ${GRADE_STYLE[p.score.grade]}`}>{p.score.grade}</span>
                    <span className="tnum w-7 text-right font-semibold text-ink">{p.score.fundhub}</span>
                  </li>
                ))}
              </ol>
              {/* The "best value" line appears only when such a provider exists (`&&`). */}
              {r.bestValue && (
                <p className="border-t border-slate-100 px-4 py-2 text-xs text-ink-600">
                  Best value:{" "}
                  <Link href={`/providers/${r.bestValue.slug}`} className="font-medium text-emerald-700 hover:underline">
                    {r.bestValue.name}
                  </Link>{" "}
                  <span className="tnum text-slate-400">(Price {r.bestValue.score.price}, Quality {r.bestValue.score.quality})</span>
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Table 2: fees per provider type (Boutique, Mid-Market, Institutional). */}
      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-ink">Fees by provider type</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="bg-canvas">
              <tr>
                <th className={th}>Type</th>
                <th className={th}>Providers</th>
                <th className={th}>Avg. headcount</th>
                <th className={th}>Typical range</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byType.map((b) => (
                <tr key={b.type}>
                  <td className="px-4 py-3 font-medium">
                    {/* `encodeURIComponent` makes a value safe to put inside a URL (it escapes characters
                        such as spaces or "&"). */}
                    <Link href={`/compare?type=${encodeURIComponent(b.type)}`} className="hover:underline">
                      {b.type}
                    </Link>
                  </td>
                  <td className={td}>{b.providers}</td>
                  <td className={td}>{formatNumber(b.avgHeadcount)}</td>
                  <td className={`${td} font-medium`}>
                    {formatEur(b.avgMin)} – {formatEur(b.avgMax)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Method note, with a link to the fee-audit advisory service (pre-selected via ?service=fee-audit). */}
      <p className="text-xs text-slate-500">
        Ranges are indicative quarterly fees reported by providers and verified against RFI responses. They exclude
        one-off set-up fees and out-of-pocket expenses. Holding a proposal above the typical range?{" "}
        <Link href="/advisory?service=fee-audit#contact" className="font-medium text-emerald-700 hover:underline">
          Get an independent fee audit
        </Link>
        .
      </p>
    </main>
  );
}
