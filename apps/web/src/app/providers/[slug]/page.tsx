/**
 * FILE: apps/web/src/app/providers/[slug]/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The public profile page of one service provider, e.g. /providers/acme-fund-services.
 *   It shows the provider's name, badges, peer rating and fee range compared with the market, a Save button,
 *   the FundHub Score breakdown, services offered, verified client reviews, licences and tech, key facts,
 *   a fee-audit offer, data sources, and similar providers.
 * WHERE IT RUNS: on the server (Node.js), as a React server component that reads the database and the login
 *   cookie. The Save button is a plain HTML form wired to a "server action", so it needs no browser code.
 * FRAMEWORK NOTES:
 *   - page.tsx = a web page; folder path = URL. [slug] is a "dynamic segment": Next.js passes the URL part as
 *     `params.slug`, so this one file serves every provider.
 *   - `dynamic = "force-dynamic"`: build the page fresh on every visit (it depends on who is logged in).
 *   - `generateMetadata`: Next.js hook for a data-dependent <title>/description.
 *   - `notFound()`: show the 404 page for an unknown or unpublished provider.
 *   - Server action: `<form action={toggleSavedProvider}>` sends the form straight to a server function
 *     (a file marked "use server"); Next.js handles the request and refreshes the page.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type alias `type Props`, object types for component props, `React.ReactNode` (anything displayable).
 *   - `Promise.all` + array destructuring; ternary `? :`; nullish `??`; logical `&&` / `||`.
 *   - tuple-array type `[string, string[]][]`: rows of [text, list of texts].
 *   - `.map`, `.filter`, `.some`, `.includes`, `.join`; destructuring with renaming `{ icon: Icon }`.
 *   - `Intl.DateTimeFormat`: JavaScript's built-in date formatter.
 *   - JSX fragment `<>...</>`: groups several things without adding an HTML element.
 */

// `import { a } from "b"` loads named exports ("next", "lucide-react" = npm libraries; "@/..." = this app's
// src folder; "@fundhub/..." = our shared packages). `import X from "b"` loads the default export.
// Metadata: the Next.js type for page title/description data.
import type { Metadata } from "next";
// Link: Next.js in-site link (no full page reload).
import Link from "next/link";
// notFound: shows the 404 page.
import { notFound } from "next/navigation";
// Icons from the Lucide library, each drawn as an inline SVG component.
import {
  ArrowLeft,
  Bookmark,
  BookmarkCheck,
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
// Small labels: Tag (grey chip), TypeBadge (provider type, e.g. "Boutique"), VerifiedBadge (FundHub Verified).
import { Tag, TypeBadge, VerifiedBadge } from "@/components/badges";
// Stars: draws a 0–5 star rating.
import { Stars } from "@/components/stars";
// ScoreBadge (the big FundHub Score with grade) and ScoreBar (a labelled 0–100 bar).
import { ScoreBadge, ScoreBar } from "@/components/score-badge";
// Account-related queries: the provider's published client reviews, and whether a user saved this provider.
import { getPublishedReviews, isProviderSaved } from "@fundhub/db/account-queries";
// getCurrentUser: reads the login cookie; returns the logged-in visitor or nothing.
import { getCurrentUser } from "@/lib/auth/session";
// toggleSavedProvider: the server action behind the Save / Saved button.
import { toggleSavedProvider } from "@/lib/saved-actions";
// Provider queries: RFI count, market-wide stats, the provider itself, and similar providers.
import { countRfisForProvider, getEcosystemStats, getProviderBySlug, getSimilarProviders } from "@fundhub/db/queries";
// Formatting helpers: euros, numbers, signed percentages ("+12%"), fee ranges, and a name's initials ("AD").
import { formatEur, formatNumber, formatPercent, formatPriceRange, initials } from "@fundhub/core/format";
// getCategory(slug) looks up one category; TAXONOMY is the full list of eight.
import { getCategory, TAXONOMY } from "@fundhub/core/taxonomy";

/** Kind: constant (Next.js setting). Render on every request (content depends on the visitor). */
export const dynamic = "force-dynamic";

/** Kind: type alias. Next.js gives the page `params`: a Promise of `{ slug: string }` from the URL. */
type Props = { params: Promise<{ slug: string }> };

/**
 * Kind: async function (Next.js metadata hook).
 * @param params  the URL's [slug], as a Promise.
 * @returns       `Promise<Metadata>`: the provider's name as the tab title and its description for search
 *                engines, or "Provider not found".
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProviderBySlug((await params).slug);
  return p ? { title: p.name, description: p.description } : { title: "Provider not found" };
}

/**
 * Kind: React component (small helper used only in this file, so not exported).
 * A white card with a small grey uppercase heading, wrapping whatever is put inside it.
 * @param title     type `string` — the heading text.
 * @param children  type `React.ReactNode` — the content placed between <Section> and </Section>.
 * @returns         JSX: the card.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}

/**
 * Kind: async React component (server component) — the provider profile page.
 * @param params  the URL's [slug], as a Promise.
 * @returns       `Promise<JSX>`: the full profile.
 */
export default async function ProviderPage({ params }: Props) {
  // Look the provider up by its slug; unknown or unpublished -> 404. After this TypeScript knows `p` exists.
  const p = await getProviderBySlug((await params).slug);
  if (!p) notFound();

  // Who is looking (null/undefined when not logged in).
  const user = await getCurrentUser();
  // Five lookups at once, named by array destructuring in the same order:
  // similar providers, market stats, number of RFIs sent to this provider, its published reviews, and
  // whether this user has saved it. For anonymous visitors there is nothing to look up, so
  // `Promise.resolve(false)` supplies an "already finished" answer of false.
  const [similar, stats, rfiCount, clientReviews, saved] = await Promise.all([
    getSimilarProviders(p),
    getEcosystemStats(),
    countRfisForProvider(p.id),
    getPublishedReviews(p.id),
    user ? isProviderSaved(user.id, p.id) : Promise.resolve(false),
  ]);
  // The provider's main category; `?? TAXONOMY[0]` falls back to the first category if the stored slug is
  // unknown, so the page never breaks.
  const category = getCategory(p.category) ?? TAXONOMY[0];
  // Its other categories: turn each slug into its category details, then `.filter` drops unknown ones
  // (`!== undefined` = "is not missing").
  const secondary = p.secondaryCategories.map((c) => getCategory(c)).filter((c) => c !== undefined);
  // Midpoint of the provider's quarterly fee range.
  const mid = (p.priceMin + p.priceMax) / 2;
  // How far that midpoint is above (+) or below (-) the market average, in percent. If the market average is
  // 0 or missing, use 0 to avoid dividing by zero.
  const vsMarket = stats.marketAvgMidpoint ? (mid / stats.marketAvgMidpoint - 1) * 100 : 0;

  // Rows for the "Key facts" box: icon component, label and display value ("—" when unknown).
  const facts = [
    { icon: Users, label: "Headcount (RCS)", value: formatNumber(p.headcount) },
    { icon: Building2, label: category.mandatesLabel, value: formatNumber(p.mandates) },
    { icon: Calendar, label: "Founded", value: p.foundedYear ?? "—" },
    { icon: MapPin, label: "Headquarters", value: p.headquarters },
    { icon: Hash, label: "RCS number", value: p.rcsNumber ?? "—" },
    { icon: Wallet, label: "Typical set-up fee", value: p.setupFee ? formatEur(p.setupFee) : "—" },
    { icon: FileText, label: "RFIs via FundHub", value: formatNumber(rfiCount) },
  ];

  // Rows for the "Licences, technology & coverage" box. The type `[string, string[]][]` means: a list of
  // pairs, each pair being [heading text, list of texts].
  const coverage: [string, string[]][] = [
    ["Licences & authorisations", p.licences],
    ["Asset classes", p.assetClasses],
    ["Tech stack", p.techStack],
    ["Regulatory scope", p.regulatoryScope],
    ["Certifications", p.certifications],
    ["Geographical footprint", p.footprint],
  ];
  // A date formatter giving British-style dates such as "3 Mar 2026".
  const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
  // When the provider last edited its own profile, and when FundHub last verified it, as date text; `null`
  // (deliberately "no value") when it never happened. (The second builds an identical formatter inline.)
  const providerUpdated = p.providerUpdatedAt ? dayFmt.format(p.providerUpdatedAt) : null;
  const lastVerified = p.lastVerifiedAt
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(p.lastVerifiedAt)
    : null;

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 p-4 sm:p-6">
      {/* Back link to the comparator, filtered to this provider's main category. */}
      <Link
        href={`/compare?category=${category.slug}`}
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to comparator
      </Link>

      {/* Header card: identity and rating on the left; price and action buttons on the right (side by side
          from medium screens, stacked on phones). */}
      <header className="flex flex-col gap-5 rounded-lg border border-slate-200 bg-white p-5 md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-4">
          {/* A dark square showing the provider's initials in place of a logo. */}
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg bg-ink-900 text-lg font-semibold text-emerald">
            {initials(p.name)}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-ink">{p.name}</h1>
              <VerifiedBadge verified={p.verified} />
              <TypeBadge type={p.providerType} />
            </div>
            {/* Main category (linked to its buyer's guide), plus "· also X, Y" when there are secondary ones.
                `<>...</>` is a fragment: it groups text without adding an HTML element. */}
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
          {/* Fee range and midpoint vs market. The ternary colours a below-market figure (negative) green. */}
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
            {/* Save button. `action={toggleSavedProvider}` makes the form call that server action; the hidden
                inputs send the provider's id and slug with it. `aria-pressed` tells screen readers whether it
                is "on"; the ternaries switch the style, icon and text between "Saved" and "Save". */}
            <form action={toggleSavedProvider}>
              <input type="hidden" name="providerId" value={p.id} />
              <input type="hidden" name="slug" value={p.slug} />
              <button
                aria-pressed={saved}
                className={
                  saved
                    ? "inline-flex items-center gap-1.5 rounded-md border border-emerald bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700"
                    : "inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-ink-600 hover:bg-slate-50"
                }
              >
                {saved ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
                {saved ? "Saved" : "Save"}
              </button>
            </form>
            {/* Website button only if a website is known. `target="_blank"` opens a new tab; `rel="noopener
                noreferrer"` stops that site from controlling our tab or seeing where the visitor came from. */}
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
            {/* Opens the RFI form with this provider pre-selected (see app/rfi/page.tsx). */}
            <Link
              href={`/rfi?provider=${p.slug}`}
              className="rounded-md bg-emerald px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              Request Quote
            </Link>
          </div>
        </div>
      </header>

      {/* FundHub Score strip. `md:grid-cols-[auto_1fr_1fr_1fr]` is a custom 4-column grid: the first column
          as wide as the badge needs, the other three sharing the rest equally. A Price Score of `null` means
          the category has too few providers to compare fees, so a different hint is shown. */}
      <section aria-label="FundHub Score" className="mt-4 grid gap-5 rounded-lg border border-slate-200 bg-white p-5 md:grid-cols-[auto_1fr_1fr_1fr]">
        <ScoreBadge score={p.score} align="start" />
        <ScoreBar label="Quality Score" value={p.score.quality} hint="75% verified peer reviews, 25% data credibility (verification, licences, certifications, freshness)." />
        <ScoreBar label="Price Score" value={p.score.price} hint={p.score.price === null ? "Too few providers in this category to compare fees yet." : `Share of ${category.label} peers with a higher typical fee.`} />
        <div className="text-xs text-slate-500">
          <p>FundHub Score = 60% Quality + 40% Price, computed only from FundHub data. Providers cannot pay to change it.</p>
          <Link href="/fundhub-score" className="mt-2 inline-block font-medium text-emerald-700 hover:underline">
            How the score works →
          </Link>
        </div>
      </section>

      {/* Main body: on large screens a wide left column (2 of 3 columns) and a narrow right column. */}
      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* `a || b` shows the description, or the fallback text if the description is empty. */}
          <Section title="Overview">
            <p className="text-sm leading-relaxed text-ink-600">{p.description || "No description provided yet."}</p>
          </Section>

          <Section title="Services (FundHub taxonomy)">
            {/* Services grouped by category. `.filter` keeps only categories where `.some` (at least one) of
                their services is in the provider's list (`.includes`); then, inside each, the same test keeps
                only the services this provider offers. */}
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

          {/* Reviews. `clientReviews.length ? (list) : (message)`: a length of 0 counts as "false", so with no
              reviews the "No verified written reviews yet." text is shown instead. In each review's details
              line, `x && ...` adds the fund structure / "since" year only when known. `last:border-0` removes
              the dividing line under the last review. */}
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

          {/* Each coverage pair becomes a heading with grey chips (`<Tag>`), or a dash when the list is empty.
              Top clients are joined into one line with " · " between names. */}
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

        {/* Right-hand column. */}
        <div className="space-y-4">
          {/* `{ icon: Icon, label, value }` destructures each fact and renames `icon` to `Icon` so it can be
              drawn as a component. `ml-auto` pushes the value to the right edge. */}
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

          {/* Green box offering a fee audit; the link pre-fills the advisory form with this provider. */}
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

          {/* Where the data comes from, then the verification and last-update dates. `&amp;` is the HTML code
              for "&". */}
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

          {/* "Similar in <category>" box, only when there are similar providers to show. */}
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
