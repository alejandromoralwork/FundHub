import Link from "next/link";
import type { Provider } from "@/db/schema";
import { formatEur, formatNumber } from "@/lib/format";
import { Tag, TypeBadge, VerifiedBadge } from "./badges";
import { Stars } from "./stars";

const Meta = ({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) => (
  <div className={className}>
    <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
    <p className="font-medium text-ink">{children}</p>
  </div>
);

export function ProviderCard({ provider: p }: { provider: Provider }) {
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
            {p.category} · {p.headquarters}
          </p>

          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs">
            <Meta label="Headcount (RCS)">
              <span className="tnum">{formatNumber(p.headcount)}</span>
            </Meta>
            <Meta label="Tech Stack">{p.techStack.join(" + ") || "—"}</Meta>
            <Meta label="Mandates" className="hidden sm:block">
              <span className="tnum">{p.mandates}</span>
            </Meta>
            <Meta label="Top Clients" className="min-w-0 max-w-full">
              <span className="block truncate">{p.topClients.join(", ") || "—"}</span>
            </Meta>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {[...p.regulatoryScope, ...p.tags].map((t) => (
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
          </div>
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
              View Full Profile
            </Link>
            <Link
              href={`/rfi?provider=${p.slug}`}
              className="flex-1 rounded-md bg-emerald px-3 py-2 text-center text-xs font-semibold text-white hover:bg-emerald-700 md:flex-none"
            >
              Request RFI / Audit Fee
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
