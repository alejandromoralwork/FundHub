import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Clock } from "lucide-react";
import { Panel, SectionTitle } from "@/components/marketing";
import { INSIGHTS } from "@/content/insights";

export const metadata: Metadata = {
  title: "Insights",
  description: "Independent research and guides on Luxembourg fund services, fees, structuring and provider selection.",
};

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function InsightsPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="Knowledge hub"
        title="Insights"
        lead="Independent guides on Luxembourg fund operations: how to choose providers, read fee proposals and structure your service chain. Written for buyers, not sponsored by providers."
      />

      <div className="grid gap-4 md:grid-cols-2">
        {INSIGHTS.map((i) => (
          <Link
            key={i.slug}
            href={`/insights/${i.slug}`}
            className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 hover:border-emerald/50 hover:shadow-sm"
          >
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{i.topic}</p>
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
          <h2 className="text-sm font-semibold text-ink">Coming soon: Luxembourg Fund Services Market Report</h2>
          <p className="mt-0.5 text-sm text-ink-600">
            Our first data-driven statistics report on fee levels, provider concentration and technology adoption
            across the eight service categories.{" "}
            <Link href="/advisory#contact" className="font-medium text-emerald-700 hover:underline">
              Ask to be notified
            </Link>
            .
          </p>
        </div>
      </Panel>
    </main>
  );
}
