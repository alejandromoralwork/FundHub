import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SectionTitle } from "@/components/marketing";
import { getCategoryCounts, getFeeBenchmarks } from "@/db/queries";
import { formatEur } from "@/lib/format";
import { TAXONOMY } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Service categories",
  description: "FundHub's standardized taxonomy of Luxembourg fund services: eight categories and their sub-services.",
};

export default async function ServicesPage() {
  const [counts, benchmarks] = await Promise.all([getCategoryCounts(), getFeeBenchmarks()]);
  const bench = new Map(benchmarks.map((b) => [b.category, b]));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="Service taxonomy"
        title="Luxembourg fund services, standardized"
        lead="Providers describe their services in bespoke ways that make comparison impossible. FundHub maps every provider to the same eight categories and sub-services, and tells you what actually matters when comparing them."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {TAXONOMY.map((c) => {
          const Icon = c.icon;
          const b = bench.get(c.slug);
          return (
            <section key={c.slug} className="flex flex-col rounded-lg border border-slate-200 bg-white p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink-900 text-emerald">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink">
                    <Link href={`/services/${c.slug}`} className="hover:underline">
                      {c.label}
                    </Link>
                  </h2>
                  <p className="text-xs text-ink-600">{c.short}</p>
                </div>
              </div>
              <ul className="mt-4 flex-1 space-y-1.5">
                {c.services.map((s) => (
                  <li key={s}>
                    <Link
                      href={`/compare?category=${c.slug}&service=${encodeURIComponent(s)}`}
                      className="flex items-center gap-2 text-sm text-ink-600 hover:text-ink hover:underline"
                    >
                      <span className="text-emerald">▸</span> {s}
                    </Link>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
                <span className="tnum text-slate-500">
                  {counts[c.slug] ?? 0} providers
                  {b && ` · typical ${formatEur(b.avgMin)} – ${formatEur(b.avgMax)}/qtr`}
                </span>
                <span className="flex gap-3">
                  <Link href={`/services/${c.slug}`} className="font-medium text-ink-600 hover:underline">
                    Buyer&apos;s guide
                  </Link>
                  <Link
                    href={`/compare?category=${c.slug}`}
                    className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline"
                  >
                    Compare <ArrowRight className="h-3 w-3" />
                  </Link>
                </span>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
