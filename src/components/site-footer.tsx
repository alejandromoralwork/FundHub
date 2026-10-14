import Link from "next/link";
import { TAXONOMY } from "@/lib/taxonomy";

const COLUMNS = [
  {
    title: "Compare",
    links: [
      { href: "/compare", label: "Provider comparator" },
      { href: "/services", label: "Service categories" },
      { href: "/benchmarks", label: "Fee benchmarks" },
      { href: "/rfi", label: "Request quotes" },
    ],
  },
  {
    title: "Advisory",
    links: [
      { href: "/advisory", label: "Independent advisory" },
      { href: "/advisory?service=fee-audit#contact", label: "Fee audit" },
      { href: "/insights", label: "Insights" },
      { href: "/methodology", label: "Methodology & data" },
    ],
  },
  {
    title: "FundHub",
    links: [
      { href: "/independence", label: "Independence charter" },
      { href: "/for-providers", label: "For service providers" },
      { href: "/methodology#api", label: "Public API" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-slate-200 bg-white">
      <div className="grid gap-8 px-4 py-8 sm:px-6 md:grid-cols-2 xl:grid-cols-5">
        <div className="xl:col-span-2">
          <p className="text-sm font-semibold text-ink">
            FundHub<span className="text-emerald"> Lux</span>
          </p>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-ink-600">
            The independent comparator and buy-side advisor for Luxembourg fund services. We are paid by fund
            managers, never by referral fees or commissions from the providers we compare.
          </p>
          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">Categories</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">
            {TAXONOMY.map((c, i) => (
              <span key={c.slug}>
                {i > 0 && " · "}
                <Link href={`/services/${c.slug}`} className="hover:text-ink hover:underline">
                  {c.label}
                </Link>
              </span>
            ))}
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{col.title}</p>
            <ul className="mt-2 space-y-1.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-xs text-ink-600 hover:text-ink hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100 px-4 py-4 text-[11px] leading-relaxed text-slate-400 sm:px-6">
        <p>
          © {new Date().getFullYear()} FundHub Lux. Fee ranges are indicative quarterly quotes, not offers. Content is
          general information, not legal, tax or investment advice. Public beta: provider profiles shown are
          illustrative sample data.
        </p>
      </div>
    </footer>
  );
}
