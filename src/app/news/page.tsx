import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Clock } from "lucide-react";
import { Panel, SectionTitle } from "@/components/marketing";
import { INSIGHTS } from "@/content/insights";
import { cn } from "@/lib/cn";

export const metadata: Metadata = {
  title: "News & Learn",
  description: "News about the Luxembourg fund services sector and independent guides on choosing providers, fees and structuring.",
};

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const TABS = [
  { key: "all", label: "All" },
  { key: "news", label: "News" },
  { key: "learn", label: "Learn" },
] as const;

export default async function NewsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const active = type === "news" || type === "learn" ? type : "all";
  const items = [...INSIGHTS]
    .filter((i) => active === "all" || i.kind === active)
    .sort((a, b) => b.published.localeCompare(a.published));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="News & Learn"
        title="Sector news and independent guides"
        lead="What's changing in Luxembourg fund services, and practical guides on choosing providers, reading fee proposals and structuring your service chain. Written for buyers, never sponsored by providers."
      />

      <nav aria-label="Filter articles" className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "all" ? "/news" : `/news?type=${t.key}`}
            aria-current={active === t.key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-3 py-2 text-sm font-medium",
              active === t.key ? "border-emerald text-ink" : "border-transparent text-slate-500 hover:text-ink",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((i) => (
          <Link
            key={i.slug}
            href={`/news/${i.slug}`}
            className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 hover:border-emerald/50 hover:shadow-sm"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
              {i.kind === "news" ? "News" : "Learn"} · {i.topic}
            </p>
            <h2 className="mt-1 text-base font-semibold text-ink">{i.title}</h2>
            <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-600">{i.summary}</p>
            <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
              {dateFmt.format(new Date(i.published))} · <Clock className="h-3 w-3" /> {i.readMinutes} min read
            </p>
          </Link>
        ))}
      </div>

      <Panel className="flex flex-col gap-3 border-dashed sm:flex-row sm:items-center">
        <BarChart3 className="h-8 w-8 shrink-0 text-emerald" />
        <div>
          <h2 className="text-sm font-semibold text-ink">Looking for market data?</h2>
          <p className="mt-0.5 text-sm text-ink-600">
            Live statistics and quarterly PDF reports are in{" "}
            <Link href="/data-intelligence" className="font-medium text-emerald-700 hover:underline">
              Data Intelligence
            </Link>
            .
          </p>
        </div>
      </Panel>
    </main>
  );
}
