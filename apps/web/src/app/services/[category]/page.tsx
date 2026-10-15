import type { Metadata } from "next";
import Link from "next/link";
import { articleHref } from "@/lib/articles";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight } from "lucide-react";
import { ButtonLink, CheckList, CtaBand, Panel } from "@/components/marketing";
import { ProviderCard } from "@/components/provider-card";
import { getFeeBenchmarks, listPublishedPosts, searchProviders } from "@fundhub/db/queries";
import { parseFilters } from "@fundhub/core/filters";
import { formatEur } from "@fundhub/core/format";
import { getCategory } from "@fundhub/core/taxonomy";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ category: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const c = getCategory((await params).category);
  return c
    ? { title: `${c.label}: buyer's guide`, description: `${c.short} What to compare, typical fees and red flags.` }
    : { title: "Category not found" };
}

export default async function CategoryGuidePage({ params }: Props) {
  const c = getCategory((await params).category);
  if (!c) notFound();

  const [benchmarks, providers] = await Promise.all([
    getFeeBenchmarks(),
    searchProviders(parseFilters({ category: c.slug, sort: "score" })),
  ]);
  const b = benchmarks.find((x) => x.category === c.slug);
  const related = await listPublishedPosts({ category: c.slug, limit: 4 });
  const Icon = c.icon;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
      <Link href="/services" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> All categories
      </Link>

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

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Sub-services we index</h2>
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
          <h2 className="text-lg font-semibold text-ink">Top-rated {c.label.toLowerCase()} providers</h2>
          <div className="flex gap-2">
            <ButtonLink href={`/rfi?service=${encodeURIComponent(c.services[0] ?? "")}`} variant="outline" className="py-2 text-xs">
              Request quotes
            </ButtonLink>
            <ButtonLink href={`/compare?category=${c.slug}`} className="py-2 text-xs">
              Compare all {providers.length} <ArrowRight className="h-3.5 w-3.5" />
            </ButtonLink>
          </div>
        </div>
        <div className="space-y-3">
          {providers.slice(0, 3).map((p) => (
            <ProviderCard key={p.id} provider={p} category={c} />
          ))}
        </div>
      </section>

      {related.length > 0 && (
        <section>
          <h2 className="mb-3 text-lg font-semibold text-ink">Related reading</h2>
          <div className="grid gap-3 md:grid-cols-2">
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

      <CtaBand
        title="Not sure what your structure needs?"
        body="Our Fund Set-up Service Map tells you which providers your structure legally requires, realistic budgets and a timeline, with no referrals attached."
        primary={{ href: "/advisory?service=fund-setup#contact", label: "Talk to an advisor" }}
      />
    </main>
  );
}
