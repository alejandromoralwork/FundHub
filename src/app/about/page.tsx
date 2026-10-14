import type { Metadata } from "next";

export const metadata: Metadata = { title: "Methodology & API" };

const endpoints = [
  {
    path: "/api/providers",
    desc: "Search published providers. Accepts the same query parameters as the comparator.",
    example: "/api/providers?category=Compliance&stack=eFront,Yardi&max=2500&sort=fee",
  },
  { path: "/api/providers/{slug}", desc: "A single provider profile.", example: "/api/providers/moselle-compliance-and-depositary" },
  { path: "/api/stats", desc: "Ecosystem metrics and fee benchmarks by category.", example: "/api/stats" },
  { path: "/api/health", desc: "Liveness and database connectivity check.", example: "/api/health" },
];

const params = [
  ["q", "Free-text search across name, description, stack, services, tags"],
  ["category", "Fund Operations | Compliance | Tax | Legal"],
  ["scale", "1-50 | 51-250 | 251-1000 | 1000+ (headcount)"],
  ["type", "Comma list: Boutique, Mid-Market, Institutional"],
  ["stack", "Comma list: eFront, Yardi, Investran, Paxus (matches any)"],
  ["reg", "Comma list: AIFMD, UCITS, RAIF, SIF, SICAR (matches any)"],
  ["min / max", "Quarterly fee bounds in EUR (range overlap)"],
  ["density", "Minimum number of active client mandates"],
  ["sort", "score (default) | fee | headcount"],
];

export default function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-6 p-4 sm:p-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h1 className="text-xl font-semibold text-ink">Methodology</h1>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">
          <p>
            <strong className="text-ink">Empirical Price Range</strong> is the indicative quarterly fee band a provider
            quotes for a standard mandate in its category, cross-checked against RFI responses received through FundHub.
          </p>
          <p>
            <strong className="text-ink">FundHub Verified</strong> means the provider&apos;s RCS registration, headcount and
            regulatory scope have been checked against public registers and supporting documents.
          </p>
          <p>
            <strong className="text-ink">Peer Opinion Score</strong> is the average rating from verified fund-industry
            reviewers on a 0–5 scale.
          </p>
          <p>
            <strong className="text-ink">Avg. Fee Deviation</strong> compares the average fee midpoint of the providers
            matching your filters with the average across the whole index.
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-ink">Public JSON API</h2>
        <ul className="mt-3 space-y-3">
          {endpoints.map((e) => (
            <li key={e.path} className="text-sm">
              <p className="font-mono text-ink">GET {e.path}</p>
              <p className="text-ink-600">{e.desc}</p>
              <a href={e.example} className="font-mono text-xs text-emerald-700 hover:underline">
                {e.example}
              </a>
            </li>
          ))}
        </ul>

        <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-slate-500">Query parameters</h3>
        <dl className="mt-2 divide-y divide-slate-100 text-sm">
          {params.map(([k, v]) => (
            <div key={k} className="flex gap-4 py-2">
              <dt className="w-24 shrink-0 font-mono text-ink">{k}</dt>
              <dd className="text-ink-600">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
