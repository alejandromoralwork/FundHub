/**
 * FILE: apps/web/src/components/provider-card.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The card for one service provider in the comparator list. Left side: name, badges, category
 *   and headquarters, a few key facts (headcount plus the facts that matter for the category being compared),
 *   and service/tag chips. Right side: the price range, FundHub Score, peer star rating, and buttons to view the
 *   profile, request a quote, or get an independent fee audit.
 * WHERE IT RUNS: on the server (no "use client" line, so it is a Next.js server component that outputs HTML).
 * FRAMEWORK NOTES: A React component is a function returning JSX (HTML-like markup). `children` is the content
 *   written between a component's tags. Lists drawn with `.map(…)` need a unique `key`. Tailwind classes:
 *   `sm:`/`md:`/`lg:` apply from small/medium/large screens upward; `hidden sm:block` = hidden on phones only.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type` and `type X` inside an import list = import types only.
 *   - intersection type `Provider & { score?: ProviderScore }` = "a Provider that may ALSO have a score".
 *   - indexed access `p[field]` = read the property whose name is in the variable `field`.
 *   - destructuring with renaming `provider: p`; nullish coalescing `a ?? b`; spread `[...arr]`.
 *   - `.sort(compareFn)`, `.slice(0, 4)`, `.includes(x)`, `.join(sep)`; `Number(true)` = 1, `Number(false)` = 0.
 */

// `import X from "b"` imports a default export; `{ a }` picks named exports.
// Next.js's link component.
import Link from "next/link";
// The TypeScript type of a provider row in the database (packages/db, our shared database package).
import type { Provider } from "@fundhub/db/schema";
// The type of a computed FundHub Score (packages/core).
import type { ProviderScore } from "@fundhub/core/score";
// Number formatters from packages/core: formatEur(1500) → "€1,500"; formatNumber(1250) → "1,250".
import { formatEur, formatNumber } from "@fundhub/core/format";
// Service-category data and types from packages/core:
//   getCategory(slug) finds a category; HIGHLIGHT_LABELS maps a highlight field to its caption;
//   TAXONOMY is the list of all categories; HighlightField and ServiceCategory are types.
import { getCategory, HIGHLIGHT_LABELS, TAXONOMY, type HighlightField, type ServiceCategory } from "@fundhub/core/taxonomy";
// Small badge/chip components (badges.tsx in this folder).
import { Tag, TypeBadge, VerifiedBadge } from "./badges";
// Star rating display (stars.tsx).
import { Stars } from "./stars";
// The FundHub Score block (score-badge.tsx).
import { ScoreBadge } from "./score-badge";

/**
 * Kind: React component (private to this file, written as an arrow function stored in a const).
 * One small "caption above value" fact on the card.
 * Props: label (`string`, the caption), children (`React.ReactNode`, the value), className (`string`, optional).
 * Returns: JSX — a <div> with a tiny grey upper-case caption and the value under it.
 */
const Meta = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
  <div className={className}>
    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    <p className="font-medium text-ink">{children}</p>
  </div>
);

/**
 * Kind: function.
 * Turns one of a provider's highlight facts into display text.
 * @param p      type `Provider` — the provider.
 * @param field  type `HighlightField` — which fact, e.g. "techStack", "licences" or "mandates".
 * @returns      `string` — e.g. "1,250" for mandates, "Multifonds + Bloomberg" for a tech stack,
 *               "AIFM, ManCo" for other lists, or "—" when the list is empty.
 */
function highlightValue(p: Provider, field: HighlightField): string {
  // "mandates" is a number (how many funds/entities), so format it with thousands separators.
  if (field === "mandates") return formatNumber(p.mandates);
  // Every other highlight field is a list of strings. `p[field]` reads the property named by `field`.
  const list = p[field];
  // Non-empty list → join it (tech stacks with " + ", others with ", "); empty list → a dash.
  return list.length ? list.join(field === "techStack" ? " + " : ", ") : "—";
}

/**
 * Kind: React component (server component).
 * @param category the category being compared. Card metrics follow its `highlights`;
 * defaults to the provider's primary category.
 * Props:
 *   - provider  type `Provider & { score?: ProviderScore }` — the provider row, optionally with its score.
 *               Renamed to the short name `p` (`provider: p`) because it is used very often below.
 *   - category  type `ServiceCategory`, optional — see above.
 * Returns: JSX — the <article> card.
 */
export function ProviderCard({ provider: p, category }: { provider: Provider & { score?: ProviderScore }; category?: ServiceCategory }) {
  // The provider's own main category; if its slug is unknown, fall back to the first category (`?? TAXONOMY[0]`).
  const primary: ServiceCategory = getCategory(p.category) ?? TAXONOMY[0];
  // The "lens" = the category whose point of view the card uses: the one being compared, else the primary.
  const lens: ServiceCategory = category ?? primary;
  // Services relevant to the category being compared come first.
  // `[...p.services]` makes a copy first, because `.sort` rearranges the list in place and we must not
  // change the original data. The compare function returns a negative/positive number to order a before/after
  // b: relevant services count as 1, others as 0, so `1 - 0` moves relevant ones forward.
  const services = [...p.services].sort(
    (a, b) => Number(lens.services.includes(b)) - Number(lens.services.includes(a)),
  );

  return (
    // The card: white, rounded, bordered; on hover the border turns faint green and a shadow appears
    // (`transition` animates it).
    <article className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-emerald/50 hover:shadow-sm">
      {/* Two halves: stacked on phones, side by side from medium screens (`md:flex-row`). */}
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        {/* LEFT HALF. `min-w-0 flex-1` lets it take the free space and shrink so long texts can be truncated. */}
        <div className="min-w-0 flex-1">
          {/* Name (linking to the profile page) followed by the "verified" and provider-type badges. */}
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-ink">
              <Link href={`/providers/${p.slug}`} className="hover:underline">
                {p.name}
              </Link>
            </h3>
            <VerifiedBadge verified={p.verified} />
            <TypeBadge type={p.providerType} />
          </div>
          <p className="mt-1 text-xs text-slate-500">
            {primary.label} · {p.headquarters}
          </p>

          {/* Key facts row. Headcount is always shown; then one fact per highlight field of the lens category. */}
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
            <Meta label="Headcount (RCS)">
              <span className="tnum">{formatNumber(p.headcount)}</span>
            </Meta>
            {/* For "mandates" the caption depends on the category (e.g. "Funds administered"); other fields use
                the shared label table. Mandates are hidden on phones; list facts are cut off with "…"
                (`truncate`) if too long. */}
            {lens.highlights.map((f) => (
              <Meta
                key={f}
                label={f === "mandates" ? lens.mandatesLabel : HIGHLIGHT_LABELS[f]}
                className={f === "mandates" ? "hidden sm:block" : "min-w-0 max-w-full"}
              >
                <span className={f === "mandates" ? "tnum" : "block truncate"}>{highlightValue(p, f)}</span>
              </Meta>
            ))}
            {/* Top clients, only on large screens (`hidden … lg:block`). `|| "—"` shows a dash for an empty list
                (joining an empty list gives "", which counts as false). */}
            <Meta label="Top Clients" className="hidden min-w-0 max-w-full lg:block">
              <span className="block truncate">{p.topClients.join(", ") || "—"}</span>
            </Meta>
          </div>

          {/* Chips row: the first 4 services (relevant ones highlighted with `accent`), a "+N more" note if
              there are more, then the provider's tags. `.slice(0, 4)` returns the first four items. */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {services.slice(0, 4).map((s) => (
              <Tag key={s} accent={lens.services.includes(s)}>
                {s}
              </Tag>
            ))}
            {services.length > 4 && <span className="text-[11px] text-slate-400">+{services.length - 4} more</span>}
            {p.tags.map((t) => (
              <Tag key={t}>{t}</Tag>
            ))}
          </div>
        </div>

        {/* RIGHT HALF: fixed width (`md:w-60`) and right-aligned from medium screens. */}
        <div className="flex shrink-0 flex-col gap-3 md:w-60 md:items-end md:text-right">
          {/* Price range per quarter, e.g. "€1,000 – €3,000/qtr", plus the typical set-up fee if known. */}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Empirical Price Range</p>
            <p className="tnum text-lg font-semibold text-ink">
              {formatEur(p.priceMin)} – {formatEur(p.priceMax)}
              <span className="text-xs font-normal text-slate-400">/qtr</span>
            </p>
            {p.setupFee && (
              <p className="text-[11px] text-slate-400 tnum">+ {formatEur(p.setupFee)} typical set-up</p>
            )}
          </div>
          {/* The FundHub Score block, only if the score was computed and passed in. */}
          {p.score && <ScoreBadge score={p.score} />}
          {/* Peer Opinion Score: stars, the rating with one decimal (`toFixed(1)`), and the review count. */}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Peer Opinion Score</p>
            <div className="mt-0.5 flex items-center gap-1 md:justify-end">
              <Stars score={p.rating} />
              <span className="tnum text-xs font-medium text-ink">{p.rating.toFixed(1)}</span>
              <span className="text-[11px] text-slate-400">({p.reviewCount})</span>
            </div>
          </div>
          {/* Two buttons sharing the width on phones (`flex-1`), natural width from medium screens. */}
          <div className="flex w-full gap-2 md:justify-end">
            <Link
              href={`/providers/${p.slug}`}
              className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-center text-xs font-medium text-ink-600 hover:bg-slate-50 md:flex-none"
            >
              View Profile
            </Link>
            {/* Opens the request-for-information form with this provider pre-selected via `?provider=`. */}
            <Link
              href={`/rfi?provider=${p.slug}`}
              className="flex-1 rounded-md bg-emerald px-3 py-2 text-center text-xs font-semibold text-white hover:bg-emerald-700 md:flex-none"
            >
              Request Quote
            </Link>
          </div>
          {/* Cross-sell to the advisory service: the query string pre-fills the contact form, and `#contact`
              scrolls straight to it. */}
          <Link
            href={`/advisory?service=fee-audit&provider=${p.slug}#contact`}
            className="text-[11px] font-medium text-emerald-700 hover:underline"
          >
            Already have a proposal? Get an independent fee audit →
          </Link>
        </div>
      </div>
    </article>
  );
}
