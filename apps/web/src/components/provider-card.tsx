import Link from "next/link";
import type { Provider } from "@fundhub/db/schema";
import type { ProviderScore } from "@fundhub/core/score";
import { formatEur, formatNumber } from "@fundhub/core/format";
import { getCategory, HIGHLIGHT_LABELS, TAXONOMY, type HighlightField, type ServiceCategory } from "@fundhub/core/taxonomy";
import { Tag, TypeBadge, VerifiedBadge } from "./badges";
import { Stars } from "./stars";
import { ScoreBadge } from "./score-badge";

const Meta = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
  <div className={className}>
    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    <p className="font-medium text-ink">{children}</p>
  </div>
);

function highlightValue(p: Provider, field: HighlightField): string {
  if (field === "mandates") return formatNumber(p.mandates);
  const list = p[field];
  return list.length ? list.join(field === "techStack" ? " + " : ", ") : "—";
}

/**
 * @param category the category being compared. Card metrics follow its `highlights`;
 * defaults to the provider's primary category.
 */
export function ProviderCard({ provider: p, category }: { provider: Provider & { score?: ProviderScore }; category?: ServiceCategory }) {
  const primary: ServiceCategory = getCategory(p.category) ?? TAXONOMY[0];
  const lens: ServiceCategory = category ?? primary;
  // Services relevant to the category being compared come first.
  const services = [...p.services].sort(
    (a, b) => Number(lens.services.includes(b)) - Number(lens.services.includes(a)),
  );

  return (
    <article className="rounded-lg border border-slate-200 bg-white p-4 transition hover:border-emerald/50 hover:shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 flex-1">
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

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
            <Meta label="Headcount (RCS)">
              <span className="tnum">{formatNumber(p.headcount)}</span>
            </Meta>
            {lens.highlights.map((f) => (
              <Meta
                key={f}
                label={f === "mandates" ? lens.mandatesLabel : HIGHLIGHT_LABELS[f]}
                className={f === "mandates" ? "hidden sm:block" : "min-w-0 max-w-full"}
              >
                <span className={f === "mandates" ? "tnum" : "block truncate"}>{highlightValue(p, f)}</span>
              </Meta>
            ))}
            <Meta label="Top Clients" className="hidden min-w-0 max-w-full lg:block">
              <span className="block truncate">{p.topClients.join(", ") || "—"}</span>
            </Meta>
          </div>

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

        <div className="flex shrink-0 flex-col gap-3 md:w-60 md:items-end md:text-right">
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
          {p.score && <ScoreBadge score={p.score} />}
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Peer Opinion Score</p>
            <div className="mt-0.5 flex items-center gap-1 md:justify-end">
              <Stars score={p.rating} />
              <span className="tnum text-xs font-medium text-ink">{p.rating.toFixed(1)}</span>
              <span className="text-[11px] text-slate-400">({p.reviewCount})</span>
            </div>
          </div>
          <div className="flex w-full gap-2 md:justify-end">
            <Link
              href={`/providers/${p.slug}`}
              className="flex-1 rounded-md border border-slate-200 px-3 py-2 text-center text-xs font-medium text-ink-600 hover:bg-slate-50 md:flex-none"
            >
              View Profile
            </Link>
            <Link
              href={`/rfi?provider=${p.slug}`}
              className="flex-1 rounded-md bg-emerald px-3 py-2 text-center text-xs font-semibold text-white hover:bg-emerald-700 md:flex-none"
            >
              Request Quote
            </Link>
          </div>
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
