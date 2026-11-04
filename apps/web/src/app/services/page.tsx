/**
 * FILE: apps/web/src/app/services/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The /services page: an overview of FundHub's standard list ("taxonomy") of the eight fund
 *   service categories. Each category gets a card with its sub-services (each linking to the comparator),
 *   how many providers offer it, the typical quarterly fee range, and links to its buyer's guide.
 * WHERE IT RUNS: on the server (Node.js), as a React server component that reads the database.
 * FRAMEWORK NOTES: page.tsx = a web page; folder path = URL (app/services/page.tsx -> /services).
 *   `metadata` sets the <title>/description; `dynamic = "force-dynamic"` renders on every visit so the counts
 *   and fee figures are always current.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Promise.all` with array destructuring `const [a, b] = await ...`.
 *   - `Map`: a built-in lookup table (key -> value); `new Map([[key, value], ...])` builds one.
 *   - arrow functions with a body `(c) => { ...; return ... }` versus short ones `(s) => (...)`.
 *   - nullish coalescing `a ?? 0`, logical `&&` in JSX, template strings.
 */

// `import { a } from "b"` loads named exports ("next", "lucide-react" = npm libraries; "@/..." = this app's
// src folder; "@fundhub/..." = our shared packages). `import X from "b"` loads the default export.
// Metadata: the Next.js type for page title/description data.
import type { Metadata } from "next";
// Link: Next.js in-site link without a full reload.
import Link from "next/link";
// ArrowRight: a right-arrow icon.
import { ArrowRight } from "lucide-react";
// SectionTitle: our heading block (small eyebrow label, title, intro text).
import { SectionTitle } from "@/components/marketing";
// getCategoryCounts: providers per category, as `{ "category-slug": number }`.
// getFeeBenchmarks: per category, the average minimum and maximum quarterly fee.
import { getCategoryCounts, getFeeBenchmarks } from "@fundhub/db/queries";
// formatEur: turns a number into euro text, e.g. 12000 -> "€12,000".
import { formatEur } from "@fundhub/core/format";
// TAXONOMY: the eight categories, each with slug, label, short description, icon and sub-services.
import { TAXONOMY } from "@fundhub/core/taxonomy";

/** Kind: constant (Next.js setting). Render on every request. */
export const dynamic = "force-dynamic";
/** Kind: constant (Next.js metadata). Tab title "Service categories · FundHub" plus description. */
export const metadata: Metadata = {
  title: "Service categories",
  description: "FundHub's standardized taxonomy of Luxembourg fund services: eight categories and their sub-services.",
};

/**
 * Kind: async React component (server component) — the page. Takes no parameters.
 * @returns `Promise<JSX>`: the heading and a two-column grid of category cards.
 */
export default async function ServicesPage() {
  // Run both database queries at the same time and wait for both; name the results `counts` and `benchmarks`.
  const [counts, benchmarks] = await Promise.all([getCategoryCounts(), getFeeBenchmarks()]);
  // Turn the benchmark array into a Map keyed by category slug, so each card can find its figures quickly
  // with `bench.get(slug)`. `[b.category, b]` is a [key, value] pair.
  const bench = new Map(benchmarks.map((b) => [b.category, b]));

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="Service taxonomy"
        title="Luxembourg fund services, standardized"
        lead="Providers describe their services in bespoke ways that make comparison impossible. FundHub maps every provider to the same eight categories and sub-services, and tells you what actually matters when comparing them."
      />

      {/* Grid: one column on phones, two from medium screens (768px+, the `md:` prefix). */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* One card per category. This arrow function has a body in curly braces, so it can set up
            variables first and must `return` the JSX explicitly. */}
        {TAXONOMY.map((c) => {
          // A component must start with a capital letter in JSX, so we copy the icon into `Icon` to draw
          // it as <Icon />.
          const Icon = c.icon;
          // This category's fee benchmark, or undefined if there is no fee data yet.
          const b = bench.get(c.slug);
          return (
            <section key={c.slug} className="flex flex-col rounded-lg border border-slate-200 bg-white p-5">
              {/* Card header: icon in a dark square, then name (linking to the buyer's guide) and summary. */}
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-ink-900 text-emerald">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-ink">
                    <Link href={`/services/${c.slug}`} className="hover:underline">
                      {c.label}
                    </Link>
                  </h2>
                  <p className="text-xs text-ink-600">{c.short}</p>
                </div>
              </div>
              {/* Sub-services, each linking to the comparator filtered to it. `encodeURIComponent(s)` makes
                  the name safe inside a URL (spaces and "&" become codes such as %20). `flex-1` lets the list
                  stretch so all card footers line up. */}
              <ul className="mt-4 flex-1 space-y-1.5">
                {c.services.map((s) => (
                  <li key={s}>
                    <Link
                      href={`/compare?category=${c.slug}&service=${encodeURIComponent(s)}`}
                      className="flex items-center gap-2 text-sm text-ink-600 hover:text-ink hover:underline"
                    >
                      <span className="text-emerald">▸</span> {s}
                    </Link>
                  </li>
                ))}
              </ul>
              {/* Card footer: provider count, typical fees, and two links. `tnum` (our CSS class) uses
                  equal-width digits so numbers line up. */}
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
                <span className="tnum text-slate-500">
                  {/* `counts[c.slug] ?? 0`: the count, or 0 if this category has no providers.
                      `b && ...`: the fee range text only appears when benchmark data exists. */}
                  {counts[c.slug] ?? 0} providers
                  {b && ` · typical ${formatEur(b.avgMin)} – ${formatEur(b.avgMax)}/qtr`}
                </span>
                <span className="flex gap-3">
                  <Link href={`/services/${c.slug}`} className="font-medium text-ink-600 hover:underline">
                    Buyer&apos;s guide
                  </Link>
                  <Link
                    href={`/compare?category=${c.slug}`}
                    className="inline-flex items-center gap-1 font-medium text-emerald-700 hover:underline"
                  >
                    Compare <ArrowRight className="h-3 w-3" />
                  </Link>
                </span>
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
