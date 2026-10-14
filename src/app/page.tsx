import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  Ban,
  Database,
  EyeOff,
  FileSearch,
  Handshake,
  Network,
  Scale,
  Search,
  ShieldCheck,
  TrendingDown,
} from "lucide-react";
import { IndependentBadge } from "@/components/badges";
import { ButtonLink, CtaBand, Panel, SectionTitle } from "@/components/marketing";
import { StatCards } from "@/components/stat-cards";
import { Stars } from "@/components/stars";
import { INSIGHTS } from "@/content/insights";
import { getCategoryCounts, getEcosystemStats, getFeeBenchmarks, getTopRatedProviders } from "@/db/queries";
import { formatEur, formatNumber, formatPriceRange } from "@/lib/format";
import { ADVISORY_SERVICES } from "@/lib/request-options";
import { TAXONOMY } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { absolute: "FundHub Lux · Independent Fund Services Comparator & Advisor in Luxembourg" },
  description:
    "Compare Luxembourg fund administrators, depositaries, ManCos, tax and legal providers on real fees, technology and peer reviews. Independent: no referral fees, no commissions.",
};

const PROBLEMS = [
  {
    icon: Network,
    title: "Referral loops, not choice",
    body: "Managers are steered to a few 'trusted' providers by the law firms and administrators who set up their fund, often under pre-agreed referral fees or reciprocal deals.",
  },
  {
    icon: EyeOff,
    title: "No public price benchmarks",
    body: "Fees are almost never published. Without market references, incoming funds routinely overpay for essential services.",
  },
  {
    icon: Scale,
    title: "Proposals you can't compare",
    body: "Each provider defines scope and fees its own way, so a true apples-to-apples comparison is impossible, and boutiques never get a fair hearing.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Compare",
    body: "Filter every indexed provider by service, licence, asset class, tech stack, scale and peer score.",
    href: "/compare",
  },
  {
    n: "02",
    title: "Benchmark",
    body: "See empirical fee ranges per category and provider type before you talk to anyone.",
    href: "/benchmarks",
  },
  {
    n: "03",
    title: "Request quotes",
    body: "Send one standardized RFI, so every proposal covers the same scope and can be compared line by line.",
    href: "/rfi",
  },
  {
    n: "04",
    title: "Negotiate",
    body: "Bring a FundHub advisor to the table for a fee audit and pricing negotiation, paid by you, not by the provider.",
    href: "/advisory",
  },
];

const ROUTE_ROWS: [string, string, string][] = [
  ["Who pays the adviser", "Often the provider, via referral fees or reciprocal deals", "Only you: flat fee or share of savings"],
  ["Providers considered", "Two or three pre-selected 'partners'", "The whole indexed market, from boutique to institutional"],
  ["Price visibility", "None; quotes requested one by one", "Empirical fee ranges and benchmarks up front"],
  ["Comparability", "Bespoke proposals, different scopes", "Standardized taxonomy and RFI"],
  ["Reviews & reputation", "Word of mouth", "Closed, verified peer reviews, independent of ad spend"],
];

export default async function HomePage() {
  const [stats, counts, benchmarks, top] = await Promise.all([
    getEcosystemStats(),
    getCategoryCounts(),
    getFeeBenchmarks(),
    getTopRatedProviders(4),
  ]);
  const bench = new Map(benchmarks.map((b) => [b.category, b]));

  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="relative overflow-hidden bg-ink-900 text-white">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage:
              "linear-gradient(to right, #fff 1px, transparent 1px), linear-gradient(to bottom, #fff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <div className="relative mx-auto max-w-6xl px-4 py-12 sm:px-6 sm:py-16">
          <IndependentBadge className="bg-emerald/15 text-emerald ring-emerald/40" />
          <h1 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight sm:text-4xl">
            Luxembourg&apos;s independent fund services comparator and buy-side advisor.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-300">
            Compare fund administrators, depositaries, ManCos, tax, legal and corporate-services providers on real fees,
            technology and peer reviews. When it&apos;s time to negotiate, our advisors sit on <em>your</em> side of the
            table. <span className="font-semibold text-white">No referral fees. No commissions. Ever.</span>
          </p>

          <form action="/compare" method="get" role="search" className="mt-7 flex max-w-2xl flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                name="q"
                aria-label="Search providers"
                placeholder="e.g. depositary-lite, eFront, RAIF, transfer pricing…"
                className="w-full rounded-md border border-white/10 bg-white py-3 pl-10 pr-3 text-sm text-ink placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-emerald px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Compare providers
            </button>
          </form>

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-300">
            {["Paid by buyers, never by referrals", "Rankings can't be bought", "Data from RCS, RESA & CSSF registers"].map(
              (t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald" /> {t}
                </span>
              ),
            )}
          </div>

          <div className="mt-8 flex flex-wrap gap-2">
            <ButtonLink href="/advisory" variant="ghost">
              <Handshake className="h-4 w-4" /> Talk to an independent advisor
            </ButtonLink>
            <ButtonLink href="/independence" variant="ghost">
              Why independence matters <ArrowRight className="h-4 w-4" />
            </ButtonLink>
          </div>
        </div>
      </section>

      <StatCards
        stats={[
          { label: "Indexed Providers", value: formatNumber(stats.indexedProviders), icon: Database },
          { label: "Service Categories", value: String(TAXONOMY.length), icon: FileSearch },
          {
            label: "Avg. Market Fee",
            value: formatEur(stats.marketAvgMidpoint),
            icon: TrendingDown,
            hint: "Midpoint per quarter, all categories",
          },
          { label: "FundHub Verified", value: formatNumber(stats.verifiedProviders), icon: BadgeCheck, accent: true },
        ]}
      />

      <div className="mx-auto max-w-6xl space-y-14 px-4 py-12 sm:px-6">
        {/* Problem */}
        <section>
          <SectionTitle
            eyebrow="The problem"
            title="The Luxembourg “black box”"
            lead="Europe's largest fund domicile still selects service providers through closed networks and personal contacts. That creates conflicts of interest and keeps prices hidden."
          />
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {PROBLEMS.map(({ icon: Icon, title, body }) => (
              <Panel key={title}>
                <Icon className="h-5 w-5 text-red-500" />
                <h3 className="mt-3 text-sm font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{body}</p>
              </Panel>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section>
          <SectionTitle
            eyebrow="How FundHub works"
            title="From opaque referrals to an objective, data-driven choice"
          />
          <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <li key={s.n}>
                <Link href={s.href} className="group block h-full rounded-lg border border-slate-200 bg-white p-5 hover:border-emerald/50">
                  <p className="font-mono text-xs text-emerald-700">{s.n}</p>
                  <h3 className="mt-1 text-sm font-semibold text-ink group-hover:underline">{s.title}</h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{s.body}</p>
                </Link>
              </li>
            ))}
          </ol>
        </section>

        {/* Categories */}
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <SectionTitle
              eyebrow="What we compare"
              title="Eight service categories, one standard taxonomy"
              lead="Every provider is mapped to the same sub-services, so you compare like with like."
            />
            <Link href="/services" className="text-sm font-medium text-emerald-700 hover:underline">
              All categories →
            </Link>
          </div>
          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {TAXONOMY.map((c) => {
              const Icon = c.icon;
              const b = bench.get(c.slug);
              return (
                <Link
                  key={c.slug}
                  href={`/services/${c.slug}`}
                  className="group flex flex-col rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald/50 hover:shadow-sm"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-ink-900 text-emerald">
                    <Icon className="h-4 w-4" />
                  </span>
                  <h3 className="mt-3 text-sm font-semibold text-ink group-hover:underline">{c.label}</h3>
                  <p className="mt-1 flex-1 text-xs leading-relaxed text-ink-600">{c.short}</p>
                  <p className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                    <span className="tnum">{counts[c.slug] ?? 0} providers</span>
                    {b && <span className="tnum">from {formatEur(b.lowestMin)}/qtr</span>}
                  </p>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Independence */}
        <section>
          <SectionTitle
            eyebrow="Independence"
            title="The referral route vs. FundHub"
            lead="We don't take a cut from the providers we compare. That's the whole point."
          />
          <div className="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-canvas text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-2.5" />
                  <th className="px-4 py-2.5">
                    <span className="flex items-center gap-1.5">
                      <Ban className="h-3.5 w-3.5 text-red-500" /> Typical referral route
                    </span>
                  </th>
                  <th className="px-4 py-2.5">
                    <span className="flex items-center gap-1.5 text-emerald-700">
                      <ShieldCheck className="h-3.5 w-3.5" /> FundHub
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ROUTE_ROWS.map(([k, them, us]) => (
                  <tr key={k}>
                    <td className="px-4 py-3 font-medium text-ink">{k}</td>
                    <td className="px-4 py-3 text-ink-600">{them}</td>
                    <td className="px-4 py-3 font-medium text-emerald-700">{us}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link href="/independence" className="mt-3 inline-block text-sm font-medium text-emerald-700 hover:underline">
            Read the Independence Charter →
          </Link>
        </section>

        {/* Advisory */}
        <section className="grid gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <SectionTitle
              eyebrow="Independent advisory"
              title="An advocate on your side of the table"
              lead="For managers who want high-touch support, our senior operational experts apply FundHub's market data directly to your provider selection and fee negotiation."
            />
            <p className="mt-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
              <span className="font-semibold">Conflict-free mandate:</span> you pay a flat advisory fee or a share of the
              savings we capture. Providers pay us nothing for your business.
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <ButtonLink href="/advisory#contact" variant="dark">
                Book a consultation
              </ButtonLink>
              <ButtonLink href="/advisory" variant="outline">
                How it works
              </ButtonLink>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:col-span-3">
            {ADVISORY_SERVICES.map((s) => (
              <Panel key={s.id} className="p-4">
                <h3 className="text-sm font-semibold text-ink">{s.label}</h3>
                <p className="mt-1 text-xs leading-relaxed text-ink-600">{s.description}</p>
              </Panel>
            ))}
          </div>
        </section>

        {/* Top-rated + insights */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <div className="flex items-end justify-between">
              <h2 className="text-lg font-semibold text-ink">Top-rated verified providers</h2>
              <Link href="/compare" className="text-xs font-medium text-emerald-700 hover:underline">
                Open comparator →
              </Link>
            </div>
            <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {top.map((p) => (
                <li key={p.id}>
                  <Link href={`/providers/${p.slug}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-ink">
                        <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald" />
                        <span className="truncate">{p.name}</span>
                      </span>
                      <span className="text-xs text-slate-500">
                        {TAXONOMY.find((c) => c.slug === p.category)?.label}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="flex items-center justify-end gap-1">
                        <Stars score={p.rating} />
                        <span className="tnum text-xs font-medium">{p.rating.toFixed(1)}</span>
                      </span>
                      <span className="tnum text-[11px] text-slate-500">{formatPriceRange(p.priceMin, p.priceMax)}/qtr</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="flex items-end justify-between">
              <h2 className="text-lg font-semibold text-ink">Latest insights</h2>
              <Link href="/insights" className="text-xs font-medium text-emerald-700 hover:underline">
                Knowledge hub →
              </Link>
            </div>
            <ul className="mt-3 space-y-3">
              {INSIGHTS.slice(0, 3).map((i) => (
                <li key={i.slug}>
                  <Link
                    href={`/insights/${i.slug}`}
                    className="block rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald/50"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{i.topic}</p>
                    <p className="mt-0.5 text-sm font-semibold text-ink">{i.title}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-ink-600">{i.summary}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <CtaBand
          title="Are you a service provider?"
          body="Every active Luxembourg provider is listed for free. Claim your profile, get your data verified at no cost, and compete on merit, not on referral networks."
          primary={{ href: "/for-providers", label: "For service providers" }}
          secondary={{ href: "/methodology", label: "Our methodology" }}
        />
      </div>
    </main>
  );
}
