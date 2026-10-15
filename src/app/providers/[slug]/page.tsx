import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Calendar,
  Database,
  ExternalLink,
  FileSearch,
  FileText,
  Hash,
  MapPin,
  ShieldCheck,
  Users,
  Wallet,
} from "lucide-react";
import { Tag, TypeBadge, VerifiedBadge } from "@/components/badges";
import { Stars } from "@/components/stars";
import { getPublishedReviews } from "@/db/account-queries";
import { countRfisForProvider, getEcosystemStats, getProviderBySlug, getSimilarProviders } from "@/db/queries";
import { formatEur, formatNumber, formatPercent, formatPriceRange, initials } from "@/lib/format";
import { getCategory, TAXONOMY } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProviderBySlug((await params).slug);
  return p ? { title: p.name, description: p.description } : { title: "Provider not found" };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

export default async function ProviderPage({ params }: Props) {
  const p = await getProviderBySlug((await params).slug);
  if (!p) notFound();

  const [similar, stats, rfiCount, clientReviews] = await Promise.all([
    getSimilarProviders(p),
    getEcosystemStats(),
    countRfisForProvider(p.id),
    getPublishedReviews(p.id),
  ]);
  const category = getCategory(p.category) ?? TAXONOMY[0];
  const secondary = p.secondaryCategories.map((c) => getCategory(c)).filter((c) => c !== undefined);
  const mid = (p.priceMin + p.priceMax) / 2;
  const vsMarket = stats.marketAvgMidpoint ? (mid / stats.marketAvgMidpoint - 1) * 100 : 0;

  const facts = [
    { icon: Users, label: "Headcount (RCS)", value: formatNumber(p.headcount) },
    { icon: Building2, label: category.mandatesLabel, value: formatNumber(p.mandates) },
    { icon: Calendar, label: "Founded", value: p.foundedYear ?? "—" },
    { icon: MapPin, label: "Headquarters", value: p.headquarters },
    { icon: Hash, label: "RCS number", value: p.rcsNumber ?? "—" },
    { icon: Wallet, label: "Typical set-up fee", value: p.setupFee ? formatEur(p.setupFee) : "—" },
    { icon: FileText, label: "RFIs via FundHub", value: formatNumber(rfiCount) },
  ];

  const coverage: [string, string[]][] = [
    ["Licences & authorisations", p.licences],
    ["Asset classes", p.assetClasses],
    ["Tech stack", p.techStack],
    ["Regulatory scope", p.regulatoryScope],
    ["Certifications", p.certifications],
    ["Geographical footprint", p.footprint],
  ];
  const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const providerUpdated = p.providerUpdatedAt ? dayFmt.format(p.providerUpdatedAt) : null;
  const lastVerified = p.lastVerifiedAt
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(p.lastVerifiedAt)
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
      <Link
        href={`/compare?category=${category.slug}`}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to comparator
      </Link>

      <header className="flex flex-col gap-5 rounded-lg border border-slate-200 bg-white p-5 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-lg font-semibold text-emerald">
            {initials(p.name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-ink">{p.name}</h1>
              <VerifiedBadge verified={p.verified} />
              <TypeBadge type={p.providerType} />
            </div>
            <p className="mt-1 text-sm text-slate-500">
              <Link href={`/services/${category.slug}`} className="hover:underline">
                {category.label}
              </Link>
              {secondary.length > 0 && <> · also {secondary.map((c) => c.label).join(", ")}</>}
            </p>
            <div className="mt-2 flex items-center gap-1.5">
              <Stars score={p.rating} />
              <span className="tnum text-sm font-medium text-ink">{p.rating.toFixed(1)}</span>
              <span className="text-xs text-slate-400">Peer Opinion Score · {p.reviewCount} reviews</span>
              <Link href={`/providers/${p.slug}/review`} className="ml-2 text-xs font-medium text-emerald-700 hover:underline">
                Write a verified review
              </Link>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-3 md:items-end md:text-right">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Empirical Price Range</p>
            <p className="tnum text-2xl font-semibold text-ink">
              {formatPriceRange(p.priceMin, p.priceMax)}
              <span className="text-sm font-normal text-slate-400">/qtr</span>
            </p>
            <p className="text-xs text-slate-500">
              Midpoint <span className="tnum">{formatEur(mid)}</span> ·{" "}
              <span className={vsMarket < 0 ? "font-medium text-emerald-700" : "font-medium text-ink"}>
                {formatPercent(vsMarket)} vs market
              </span>
            </p>
          </div>
          <div className="flex gap-2">
            {p.website && (
              <a
                href={p.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-ink-600 hover:bg-slate-50"
              >
                Website <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Link
              href={`/rfi?provider=${p.slug}`}
              className="rounded-md bg-emerald px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Request Quote
            </Link>
          </div>
        </div>
      </header>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Section title="Overview">
            <p className="text-sm leading-relaxed text-ink-600">{p.description || "No description provided yet."}</p>
          </Section>

          <Section title="Services (FundHub taxonomy)">
            <div className="space-y-3">
              {TAXONOMY.filter((c) => c.services.some((sv) => p.services.includes(sv))).map((c) => (
                <div key={c.slug}>
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{c.label}</p>
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {c.services
                      .filter((sv) => p.services.includes(sv))
                      .map((sv) => (
                        <li key={sv} className="flex items-center gap-2 text-sm text-ink-600">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald" /> {sv}
                        </li>
                      ))}
                  </ul>
                </div>
              ))}
            </div>
          </Section>

          <Section title={`What to compare in ${category.label}`}>
            <ul className="grid gap-x-5 gap-y-1.5 text-sm text-ink-600 sm:grid-cols-2">
              {category.compareOn.map((c) => (
                <li key={c} className="flex gap-2">
                  <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-emerald" />
                  {c}
                </li>
              ))}
            </ul>
          </Section>

          <Section title={`Verified client reviews (${clientReviews.length})`}>
            {clientReviews.length ? (
              <ul className="space-y-4">
                {clientReviews.map((r) => (
                  <li key={r.id} className="border-b border-slate-100 pb-4 last:border-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Stars score={r.overall} />
                      <span className="text-sm font-semibold text-ink">{r.title}</span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-slate-500">
                      <ShieldCheck className="h-3 w-3 text-emerald" /> Verified client · {r.reviewerRole}
                      {r.fundStructure && ` · ${r.fundStructure}`} · {r.relationship}
                      {r.clientSince && ` since ${r.clientSince}`}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-ink-600">{r.body}</p>
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                      <span>Service {r.serviceQuality}/5</span>
                      <span>Responsiveness {r.responsiveness}/5</span>
                      <span>Pricing transparency {r.pricingTransparency}/5</span>
                      <span>Technology {r.technology}/5</span>
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink-600">No verified written reviews yet.</p>
            )}
            <Link
              href={`/providers/${p.slug}/review`}
              className="mt-4 inline-block rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-ink-600 hover:bg-slate-50"
            >
              Are you a client? Write a verified review
            </Link>
          </Section>

          <Section title="Licences, technology & coverage">
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              {coverage.map(([label, values]) => (
                <div key={label}>
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {values.length ? values.map((t) => <Tag key={t}>{t}</Tag>) : <span className="text-slate-400">—</span>}
                  </dd>
                </div>
              ))}
              <div className="sm:col-span-2">
                <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Top existing clients</dt>
                <dd className="mt-1 text-ink-600">{p.topClients.join(" · ") || "—"}</dd>
              </div>
            </dl>
          </Section>
        </div>

        <div className="space-y-4">
          <Section title="Key facts">
            <dl className="space-y-2.5">
              {facts.map(({ icon: Icon, label, value }) => (
                <div key={label} className="flex items-center gap-2 text-sm">
                  <Icon className="h-4 w-4 text-slate-400" />
                  <dt className="text-slate-500">{label}</dt>
                  <dd className="ml-auto font-medium text-ink tnum">{value}</dd>
                </div>
              ))}
            </dl>
          </Section>

          <section className="rounded-lg border border-emerald/40 bg-emerald-50 p-5">
            <p className="flex items-center gap-2 text-sm font-semibold text-ink">
              <FileSearch className="h-4 w-4 shrink-0 text-emerald-700" /> Received a proposal from {p.name}?
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink-600">
              Our advisors benchmark it line by line against the market and flag hidden items. Paid by you only; we
              take nothing from {p.name}.
            </p>
            <Link
              href={`/advisory?service=fee-audit&provider=${p.slug}#contact`}
              className="mt-3 inline-block rounded-md bg-ink-900 px-3 py-2 text-xs font-semibold text-white hover:bg-ink-800"
            >
              Request an independent fee audit
            </Link>
          </section>

          <Section title="Data sources">
            <ul className="space-y-2 text-xs text-ink-600">
              <li className="flex gap-2">
                <Database className="h-3.5 w-3.5 shrink-0 text-slate-400" /> Legal status &amp; headcount: RCS / RESA
              </li>
              <li className="flex gap-2">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-slate-400" /> Licences: CSSF public registers
              </li>
              <li className="flex gap-2">
                <FileText className="h-3.5 w-3.5 shrink-0 text-slate-400" /> Fees: RFI responses &amp; fee audits
              </li>
            </ul>
            <p className="mt-3 text-[11px] text-slate-400">
              {lastVerified ? `Last verified ${lastVerified}.` : "Not yet verified."}
              {providerUpdated && ` Profile updated by the provider on ${providerUpdated}.`}{" "}
              <Link href="/methodology" className="hover:underline">
                Methodology
              </Link>
            </p>
            <Link href="/account" className="mt-2 inline-block text-[11px] font-medium text-emerald-700 hover:underline">
              Is this your company? Manage this profile →
            </Link>
          </Section>

          {similar.length > 0 && (
            <Section title={`Similar in ${category.label}`}>
              <ul className="space-y-3">
                {similar.map((s) => (
                  <li key={s.id}>
                    <Link href={`/providers/${s.slug}`} className="group block">
                      <p className="text-sm font-medium text-ink group-hover:underline">{s.name}</p>
                      <p className="text-xs text-slate-500 tnum">
                        {formatPriceRange(s.priceMin, s.priceMax)}/qtr · {s.rating.toFixed(1)}★
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </main>
  );
}
