import type { Metadata } from "next";
import Link from "next/link";
import { ASSET_CLASSES, LICENCES, PROVIDER_TYPES, REGULATORY_SCOPES, TECH_STACKS } from "@fundhub/db/schema";
import { CATEGORY_SLUGS } from "@fundhub/core/taxonomy";

export const metadata: Metadata = {
  title: "Methodology & data",
  description: "How FundHub sources, verifies and scores Luxembourg fund service provider data, plus the public JSON API.",
};

const DATA_LAYERS = [
  ["Legal & status", "Luxembourg Business Registers (RCS) and RESA", "Automated refresh every 48 hours"],
  ["Regulatory licences", "CSSF public registers of authorised entities and AIFMs", "Synchronized weekly"],
  ["Beneficial ownership", "Registre des Bénéficiaires Effectifs (RBE)", "Checked at onboarding and on change"],
  ["Tech stack & headcount", "Direct management DDQ (Pro and verified providers)", "Mandatory validation twice a year"],
  ["Pricing indicators", "Anonymized RFI responses and fee-audit pools", "Continuous, after each closed advisory cycle"],
  ["Peer reviews", "Closed, double-blind loop of authenticated asset managers", "Continuous; uncoupled from ad spend"],
];

const DEFINITIONS = [
  [
    "Empirical Price Range",
    "The indicative quarterly fee band for a standard mandate in the provider's primary category, built from RFI responses, fee audits and provider disclosures. It excludes one-off set-up fees (shown separately) and out-of-pocket expenses.",
  ],
  [
    "FundHub Verified",
    "The provider's RCS registration, CSSF authorisations, headcount and stated tech stack have been checked against public registers and a management DDQ. Verification is free and independent of any subscription.",
  ],
  [
    "Peer Opinion Score",
    "Average rating (0–5) from authenticated fund-industry reviewers in a closed, double-blind loop. Written client reviews are published only after FundHub verifies the reviewer's work email and client relationship; reviewer identities are never shown. Providers cannot remove, edit or pay for reviews, and their staff cannot review themselves.",
  ],
  [
    "FundHub Score",
    "An independent 0–100 grade (A+ to D) combining a Quality Score (verified peer reviews and data credibility) and a Price Score (how the provider's typical fee compares with its category peers). The full formula is published on the FundHub Score page.",
  ],
  [
    "Avg. Fee Deviation",
    "The average fee midpoint of the providers matching your filters compared with the average across the whole index.",
  ],
  [
    "Service taxonomy",
    "Every provider is mapped to FundHub's eight macro-categories and their standardized sub-services, so that like-for-like comparison is possible.",
  ],
];

const endpoints = [
  {
    path: "/api/providers",
    desc: "Search published providers. Accepts the same query parameters as the comparator.",
    example: "/api/providers?category=depositary-banking&asset=Real%20Estate&sort=fee",
  },
  { path: "/api/providers/{slug}", desc: "A single provider profile.", example: "/api/providers/syre-depositary-services" },
  { path: "/api/stats", desc: "Ecosystem metrics and fee benchmarks by category.", example: "/api/stats" },
  { path: "/api/health", desc: "Liveness and database connectivity check.", example: "/api/health" },
];

const params = [
  ["q", "Free-text search across name, description, stack, services, tags, licences, asset classes"],
  ["category", CATEGORY_SLUGS.join(" | ")],
  ["service", "Comma list of sub-services from the taxonomy (matches any)"],
  ["scale", "1-50 | 51-250 | 251-1000 | 1000+ (headcount)"],
  ["type", `Comma list: ${PROVIDER_TYPES.join(", ")}`],
  ["asset", `Comma list: ${ASSET_CLASSES.join(", ")}`],
  ["licence", `Comma list: ${LICENCES.join(", ")}`],
  ["stack", `Comma list: ${TECH_STACKS.join(", ")} (matches any)`],
  ["reg", `Comma list: ${REGULATORY_SCOPES.join(", ")} (matches any)`],
  ["min / max", "Quarterly fee bounds in EUR (range overlap)"],
  ["density", "Minimum number of active client mandates"],
  ["sort", "score (FundHub Score, default) | quality | price | fee | headcount"],
];

export default function MethodologyPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <h1 className="text-xl font-semibold text-ink">Methodology</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-600">
          FundHub is a neutral data layer between asset managers and service providers. Our outputs are only as good as
          our inputs, so here is exactly where the data comes from, how often it is refreshed and how every metric is
          defined. For how we stay commercially independent, see the{" "}
          <Link href="/independence" className="font-medium text-emerald-700 hover:underline">
            Independence Charter
          </Link>
          .
        </p>
        <dl className="mt-4 divide-y divide-slate-100 text-sm">
          {DEFINITIONS.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
              <dt className="w-44 shrink-0 font-medium text-ink">{k}</dt>
              <dd className="leading-relaxed text-ink-600">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-5 py-3 text-lg font-semibold text-ink">Data sources & governance</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-canvas text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-2.5">Data layer</th>
                <th className="px-5 py-2.5">Source</th>
                <th className="px-5 py-2.5">Validation frequency</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {DATA_LAYERS.map(([layer, source, freq]) => (
                <tr key={layer}>
                  <td className="px-5 py-3 font-medium text-ink">{layer}</td>
                  <td className="px-5 py-3 text-ink-600">{source}</td>
                  <td className="px-5 py-3 text-ink-600">{freq}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
          Public beta: provider profiles currently shown are illustrative sample data while the live registry pipelines
          are being connected.
        </p>
      </section>

      <section id="api" className="scroll-mt-20 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-ink">Public JSON API</h2>
        <ul className="mt-3 space-y-3">
          {endpoints.map((e) => (
            <li key={e.path} className="text-sm">
              <p className="font-mono text-ink">GET {e.path}</p>
              <p className="text-ink-600">{e.desc}</p>
              <a href={e.example} className="break-all font-mono text-xs text-emerald-700 hover:underline">
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
              <dd className="min-w-0 break-words text-ink-600">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
