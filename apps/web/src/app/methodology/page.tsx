/**
 * FILE: apps/web/src/app/methodology/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The /methodology page. It explains how every FundHub metric is defined, where each layer of
 *   provider data comes from and how often it is checked, and documents the free public JSON API
 *   (its addresses and the query parameters it accepts).
 * WHERE IT RUNS: on the server (Node.js), as a React server component. It reads no database (the lists of
 *   allowed values come from shared constants), so Next.js can pre-build it once.
 * FRAMEWORK NOTES: In the Next.js App Router, page.tsx inside app/ is a web page and its folder path is the
 *   URL (app/methodology/page.tsx -> /methodology). Exporting `metadata` sets the <title>/description.
 *   `id="api"` on a section lets other pages link straight to it with /methodology#api.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - arrays of arrays (`[["a", "b", "c"], ...]`) and arrays of objects.
 *   - array destructuring in parameters `([layer, source, freq]) =>`: name each item of a row.
 *   - `.join(", ")`: glue an array's items into one text with ", " between them.
 *   - template strings `` `Comma list: ${...}` ``.
 */

// `import { a } from "b"` loads named exports ("next" = npm library; "@fundhub/..." = our shared packages).
// `import X from "b"` loads the module's default export.
// Metadata: the Next.js type for page title/description data.
import type { Metadata } from "next";
// Link: Next.js in-site link without a full reload.
import Link from "next/link";
// The lists of allowed values defined next to the database tables (packages/db): provider types, asset
// classes, licence types, tech stacks and regulatory scopes. Showing them here keeps the API docs in step.
import { ASSET_CLASSES, LICENCES, PROVIDER_TYPES, REGULATORY_SCOPES, TECH_STACKS } from "@fundhub/db/schema";
// CATEGORY_SLUGS: the URL names of the eight service categories (e.g. "depositary-banking").
import { CATEGORY_SLUGS } from "@fundhub/core/taxonomy";

/** Kind: constant (Next.js metadata). Tab title "Methodology & data · FundHub" plus description. */
export const metadata: Metadata = {
  title: "Methodology & data",
  description: "How FundHub sources, verifies and scores Luxembourg fund service provider data, plus the public JSON API.",
};

/**
 * Kind: constant (array of three-item arrays). One table row per data layer:
 * [what the data is, where it comes from, how often it is validated].
 */
const DATA_LAYERS = [
  ["Legal & status", "Luxembourg Business Registers (RCS) and RESA", "Automated refresh every 48 hours"],
  ["Regulatory licences", "CSSF public registers of authorised entities and AIFMs", "Synchronized weekly"],
  ["Beneficial ownership", "Registre des Bénéficiaires Effectifs (RBE)", "Checked at onboarding and on change"],
  ["Tech stack & headcount", "Direct management DDQ (Pro and verified providers)", "Mandatory validation twice a year"],
  ["Pricing indicators", "Anonymized RFI responses and fee-audit pools", "Continuous, after each closed advisory cycle"],
  ["Peer reviews", "Closed, double-blind loop of authenticated asset managers", "Continuous; uncoupled from ad spend"],
];

/**
 * Kind: constant (array of two-item arrays). Each pair is [term, definition] for the glossary at the top.
 */
const DEFINITIONS = [
  [
    "Empirical Price Range",
    "The indicative quarterly fee band for a standard mandate in the provider's primary category, built from RFI responses, fee audits and provider disclosures. It excludes one-off set-up fees (shown separately) and out-of-pocket expenses.",
  ],
  [
    "FundHub Verified",
    "The provider's RCS registration, CSSF authorisations, headcount and stated tech stack have been checked against public registers and a management DDQ. The verification audit is part of the provider subscription, but the badge is granted only when the checks pass, is re-checked twice a year and can be withdrawn. It has no effect on the FundHub Score, rankings or reviews.",
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

/**
 * Kind: constant (array of objects). The public API addresses: `path` (the address), `desc` (what it
 * returns) and `example` (a working sample link). `{slug}` in a path is a placeholder for a provider's slug.
 */
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

/**
 * Kind: constant (array of two-item arrays). Each pair is [query parameter name, what it accepts].
 * Where the allowed values come from shared lists, `.join(...)` builds the text from them, so the docs
 * update automatically when a new value is added. (A plain constant, not the Next.js `params` prop.)
 */
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

/**
 * Kind: React component (server component) — the page. Takes no parameters.
 * @returns JSX: three white cards: definitions, data sources table, and API documentation.
 */
export default function MethodologyPage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      {/* Card 1: introduction and the glossary of definitions. */}
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
        {/* <dl> = HTML definition list (<dt> term, <dd> definition). `([k, v]) =>` names the two items of each
            pair; the term `k` doubles as React's list `key`. Stacked on phones, side by side from `sm:`. */}
        <dl className="mt-4 divide-y divide-slate-100 text-sm">
          {DEFINITIONS.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-6">
              <dt className="w-44 shrink-0 font-medium text-ink">{k}</dt>
              <dd className="leading-relaxed text-ink-600">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Card 2: data sources table. `overflow-hidden` clips the table to the rounded corners;
          the inner `overflow-x-auto` lets the 640px-wide table scroll sideways on phones. */}
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
              {/* Each row array is destructured into three names, one per table cell. */}
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

      {/* Card 3: the public API. `scroll-mt-20` leaves room under the sticky header when jumping to #api. */}
      <section id="api" className="scroll-mt-20 rounded-lg border border-slate-200 bg-white p-5">
        <h2 className="text-lg font-semibold text-ink">Public JSON API</h2>
        <ul className="mt-3 space-y-3">
          {/* One item per endpoint. A plain <a> (not Link) is used for the example because it opens raw JSON
              data, not one of our pages. `break-all` lets long URLs wrap anywhere on small screens. */}
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
        {/* Parameter name on the left (fixed width `w-24`), what it accepts on the right. */}
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
