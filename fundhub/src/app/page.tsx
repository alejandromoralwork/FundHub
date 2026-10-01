import { BadgeCheck, Database, FileSearch, SearchX, TrendingDown } from "lucide-react";
import { FilterBar } from "@/components/filter-bar";
import { FilterPane } from "@/components/filter-pane";
import { MobileFilters } from "@/components/mobile-filters";
import { ProviderCard } from "@/components/provider-card";
import { SortSelect } from "@/components/sort-select";
import { StatCards } from "@/components/stat-cards";
import { getEcosystemStats, getProviderTypeCounts, searchProviders } from "@/db/queries";
import { parseFilters, type ProviderFilters, type RawSearchParams } from "@/lib/filters";
import { formatNumber, formatPercent } from "@/lib/format";

// Always render with fresh data from the database.
export const dynamic = "force-dynamic";

function countSidePaneFilters(f: ProviderFilters) {
  return [f.min !== undefined || f.max !== undefined, f.type.length > 0, !!f.density, f.reg.length > 0].filter(Boolean)
    .length;
}

export default async function ComparatorPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const filters = parseFilters(await searchParams);
  const [results, stats, typeCounts] = await Promise.all([
    searchProviders(filters),
    getEcosystemStats(),
    getProviderTypeCounts(),
  ]);

  // How the matched set's average fee midpoint compares to the whole market.
  const matchedMid = results.length
    ? results.reduce((sum, p) => sum + (p.priceMin + p.priceMax) / 2, 0) / results.length
    : 0;
  const deviation = stats.marketAvgMidpoint && results.length ? (matchedMid / stats.marketAvgMidpoint - 1) * 100 : 0;

  return (
    <>
      <FilterBar />
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
        <aside className="hidden w-72 shrink-0 self-stretch border-r border-slate-200 bg-white xl:block">
          <div className="thin-scroll sticky top-16 max-h-[calc(100vh-4rem)] overflow-y-auto">
            <FilterPane typeCounts={typeCounts} />
          </div>
        </aside>

        <section className="min-w-0 flex-1 p-4 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
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
              <MobileFilters typeCounts={typeCounts} activeCount={countSidePaneFilters(filters)} />
              <SortSelect />
            </div>
          </div>

          {results.length ? (
            <div className="space-y-3">
              {results.map((p) => (
                <ProviderCard key={p.id} provider={p} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <SearchX className="h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm font-semibold text-ink">No providers match these parameters</p>
              <p className="mt-1 max-w-sm text-xs text-slate-500">
                Widen the price bounds, remove a tech-stack chip, or reset all filters to see the full index.
              </p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
