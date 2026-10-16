import type { Metadata } from "next";
import Link from "next/link";
import { desc } from "drizzle-orm";
import { BadgeCheck, Database, Download, FileText, Globe, Lock, LockOpen, Sparkles, TrendingUp } from "lucide-react";
import { BarList } from "@/components/bar-list";
import { Panel, SectionTitle } from "@/components/marketing";
import { RequestForm } from "@/components/request-form";
import { StatCards } from "@/components/stat-cards";
import { BUILT_IN_REPORTS, currentQuarter } from "@/content/reports";
import { db } from "@fundhub/db/client";
import { getMarketStats, listProviderOptions } from "@fundhub/db/queries";
import { reports } from "@fundhub/db/schema";
import { canAccessPrivateReports, getCurrentUser } from "@/lib/auth/session";
import { formatEur, formatNumber } from "@fundhub/core/format";
import { categoryLabel } from "@fundhub/core/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Data Intelligence",
  description:
    "Live statistics on Luxembourg fund services, quarterly public and private PDF reports, and bespoke data-intelligence services.",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

type ReportCard = {
  slug: string;
  title: string;
  period: string;
  summary: string;
  visibility: "public" | "private";
  contents?: readonly string[];
  live: boolean;
};

export default async function DataIntelligencePage() {
  const [stats, uploaded, user, providers] = await Promise.all([
    getMarketStats(),
    db
      .select({
        slug: reports.slug,
        title: reports.title,
        period: reports.period,
        summary: reports.summary,
        visibility: reports.visibility,
      })
      .from(reports)
      .orderBy(desc(reports.createdAt)),
    getCurrentUser(),
    listProviderOptions(),
  ]);
  const hasPrivateAccess = await canAccessPrivateReports(user);

  const cards: ReportCard[] = [
    ...BUILT_IN_REPORTS.map((r) => ({ ...r, period: currentQuarter(), live: true })),
    ...uploaded.map((r) => ({ ...r, live: false })),
  ];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-10 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="Data Intelligence"
        title="The Luxembourg fund services market, in numbers"
        lead="Live statistics computed from FundHub's index, quarterly PDF reports (public and private), and bespoke analyses for firms that need more."
      />

      <div className="overflow-hidden rounded-lg border border-slate-200">
        <StatCards
          stats={[
            { label: "Indexed Providers", value: formatNumber(stats.providers), icon: Database },
            {
              label: "Verified",
              value: pct(stats.providers ? stats.verified / stats.providers : 0),
              icon: BadgeCheck,
              hint: `${stats.verified} providers`,
              accent: true,
            },
            { label: "Service Categories", value: String(stats.byCategory.length), icon: Globe },
            { label: "RFIs Logged", value: formatNumber(stats.rfiCount), icon: TrendingUp },
          ]}
        />
      </div>

      <section className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <h2 className="text-sm font-semibold text-ink">Typical quarterly fee by category</h2>
          <p className="mb-4 text-xs text-slate-500">Midpoint of the average empirical range, € per quarter</p>
          <BarList
            rows={stats.byCategory.map((b) => {
              const mid = Math.round((b.avgMin + b.avgMax) / 2);
              return {
                label: categoryLabel(b.category),
                value: mid,
                display: formatEur(mid),
                hint: `typical ${formatEur(b.avgMin)} – ${formatEur(b.avgMax)}, ${b.providers} providers`,
              };
            })}
            caption="Excludes set-up fees and out-of-pocket expenses."
          />
        </Panel>
        <Panel>
          <h2 className="text-sm font-semibold text-ink">Software penetration</h2>
          <p className="mb-4 text-xs text-slate-500">Share of indexed providers using each system</p>
          <BarList
            rows={stats.techStack.slice(0, 8).map((t) => ({
              label: t.label,
              value: t.share,
              display: pct(t.share),
              hint: `${t.count} providers`,
            }))}
            max={1}
          />
        </Panel>
        <Panel>
          <h2 className="text-sm font-semibold text-ink">Licence coverage</h2>
          <p className="mb-4 text-xs text-slate-500">Share of indexed providers holding each authorisation</p>
          <BarList
            rows={stats.licences.map((t) => ({ label: t.label, value: t.share, display: pct(t.share), hint: `${t.count} providers` }))}
            max={1}
          />
        </Panel>
        <Panel>
          <h2 className="text-sm font-semibold text-ink">Asset-class coverage</h2>
          <p className="mb-4 text-xs text-slate-500">Share of indexed providers servicing each asset class</p>
          <BarList
            rows={stats.assetClasses.map((t) => ({ label: t.label, value: t.share, display: pct(t.share), hint: `${t.count} providers` }))}
            max={1}
          />
        </Panel>
      </section>
      <p className="-mt-6 text-[11px] text-slate-400">
        Public beta: statistics are computed live from illustrative sample data. Buyer-demand statistics are in the
        private Provider Intelligence Report.{" "}
        <Link href="/methodology" className="hover:underline">
          Methodology
        </Link>
      </p>

      <section id="reports" className="scroll-mt-20">
        <SectionTitle
          eyebrow="Quarterly reports"
          title="Reports (PDF)"
          lead="Public reports are free for everyone. Private reports are for members, and included for approved service-provider accounts."
        />
        {!hasPrivateAccess && (
          <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Private reports are for FundHub members.{" "}
            <Link href="/data-intelligence/membership" className="font-semibold underline">
              Become a member
            </Link>
          </p>
        )}
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {cards.map((r) => {
            const locked = r.visibility === "private" && !hasPrivateAccess;
            return (
              <Panel key={r.slug} className="flex flex-col">
                <div className="flex items-start justify-between gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-emerald" />
                  <span
                    className={
                      r.visibility === "public"
                        ? "inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                        : "inline-flex items-center gap-1 rounded-full bg-ink-900 px-2 py-0.5 text-[11px] font-semibold text-white"
                    }
                  >
                    {r.visibility === "public" ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    {r.visibility === "public" ? "Public" : "Provider accounts"}
                  </span>
                </div>
                <h3 className="mt-3 text-sm font-semibold text-ink">{r.title}</h3>
                <p className="text-xs text-slate-500">
                  {r.period}
                  {r.live && " · generated from live data"}
                </p>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-600">{r.summary}</p>
                {r.contents && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-ink-600">
                    {r.contents.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                )}
                <div className="mt-4">
                  {locked ? (
                    <Link
                      href="/data-intelligence/membership"
                      className="inline-flex items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-slate-50"
                    >
                      <Lock className="h-3.5 w-3.5" /> Members only: unlock
                    </Link>
                  ) : (
                    <a
                      href={`/data-intelligence/reports/${r.slug}`}
                      className="inline-flex items-center gap-2 rounded-md bg-emerald px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
                    >
                      {r.visibility === "private" ? <LockOpen className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                      Download PDF
                    </a>
                  )}
                </div>
              </Panel>
            );
          })}
        </div>
      </section>

      <section id="private-services" className="grid scroll-mt-20 gap-6 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <SectionTitle
            eyebrow="Private services"
            title="Bespoke data intelligence"
            lead="For providers, managers and investors who need more than the standard reports: custom benchmarks, competitor analysis and market studies built on FundHub's proprietary data."
          />
          <ul className="mt-4 space-y-2 text-sm text-ink-600">
            {[
              "Custom fee benchmarks by service, size and asset class",
              "Competitor and market-share analysis",
              "Market-entry studies for firms coming to Luxembourg",
              "Technology adoption studies",
              "Data extracts and API access",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald" />
                {t}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-slate-500">
            Analyses use anonymized, aggregated data. We never disclose an individual buyer, RFI or client.
          </p>
        </div>
        <div className="lg:col-span-3">
          <RequestForm requestType="data" providers={providers} />
        </div>
      </section>
    </main>
  );
}
