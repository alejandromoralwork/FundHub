import type { Metadata } from "next";
import Link from "next/link";
import { getCategoryRankings, getEcosystemStats, getFeeBenchmarks, getFeeBenchmarksByType } from "@fundhub/db/queries";
import { formatEur, formatNumber } from "@fundhub/core/format";
import { categoryLabel } from "@fundhub/core/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Fee Benchmarks & Rankings",
  description: "Typical quarterly fees per Luxembourg fund service category, and provider rankings by FundHub Score.",
};

const GRADE_STYLE: Record<string, string> = { "A+": "bg-emerald", A: "bg-emerald-600", B: "bg-sky-600", C: "bg-amber-500", D: "bg-slate-400" };

const th = "px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500";
const td = "px-4 py-3 tnum";

export default async function BenchmarksPage() {
  const [byCategory, byType, stats, rankings] = await Promise.all([
    getFeeBenchmarks(),
    getFeeBenchmarksByType(),
    getEcosystemStats(),
    getCategoryRankings(5),
  ]);
  const scaleMax = Math.max(...byCategory.map((b) => b.highestMax), 1);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Fee Benchmarks & Rankings</h1>
        <p className="mt-1 text-sm text-ink-600">
          Empirical quarterly fee ranges across {formatNumber(stats.indexedProviders)} indexed providers. Market average
          midpoint: <span className="tnum font-medium text-ink">{formatEur(stats.marketAvgMidpoint)}</span>/qtr.
        </p>
      </div>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-ink">Fees by macro-category</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-canvas">
              <tr>
                <th className={th}>Category</th>
                <th className={th}>Providers</th>
                <th className={th}>Typical range (avg. min – avg. max)</th>
                <th className={`${th} w-1/3`}>Full spread</th>
                <th className={th}>Avg. peer rating</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {byCategory.map((b) => (
                <tr key={b.category}>
                  <td className="px-4 py-3 font-medium">
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
                  <td className={td}>{b.avgRating.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

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
              <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2.5">
                <Link href={`/compare?category=${r.category}&sort=score`} className="text-sm font-semibold text-ink hover:underline">
                  {categoryLabel(r.category)}
                </Link>
                <span className="text-[11px] text-slate-400">{r.providers} providers</span>
              </div>
              <ol className="divide-y divide-slate-100">
                {r.top.map((p, i) => (
                  <li key={p.id} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="tnum w-4 text-xs text-slate-400">{i + 1}</span>
                    <Link href={`/providers/${p.slug}`} className="min-w-0 flex-1 truncate font-medium text-ink hover:underline">
                      {p.name}
                    </Link>
                    <span className="tnum hidden text-[11px] text-slate-400 sm:inline">
                      Q {p.score.quality} · P {p.score.price ?? "n/a"}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold text-white ${GRADE_STYLE[p.score.grade]}`}>{p.score.grade}</span>
                    <span className="tnum w-7 text-right font-semibold text-ink">{p.score.fundhub}</span>
                  </li>
                ))}
              </ol>
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
