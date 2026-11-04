/**
 * FILE: apps/web/src/app/fundhub-score/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The /fundhub-score page, which explains in public how the FundHub Score (0–100) is worked
 *   out: Quality Score (peer reviews + data credibility) combined with Price Score, the letter grades, and
 *   what the score is not. All the numbers shown (weights, thresholds, grade limits) are read from the same
 *   shared constants the real calculation uses, so the explanation can never drift from the formula.
 * WHERE IT RUNS: on the server (Node.js), as a React server component. It reads no database, so it is plain
 *   static content.
 * FRAMEWORK NOTES: In the Next.js App Router, page.tsx inside app/ is a web page and its folder path is the
 *   URL (app/fundhub-score/page.tsx -> /fundhub-score). Exporting `metadata` sets the <title>/description.
 *   Without `dynamic = "force-dynamic"` and without data reads, Next.js pre-builds this page once.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - arrow function constant `const pct = (n: number) => ...`: a small function stored in a constant.
 *   - template strings `` `${a}%` ``: text with values inserted.
 *   - ternary `cond ? a : b` and array index `GRADES[i - 1]` (the previous item in the list).
 *   - array literal `[...]` passed directly as a prop; objects `{ href, label }` as props.
 */

// `import { a } from "b"` loads named exports ("next" = npm library; "@fundhub/..." = our shared packages;
// "@/..." = this app's src folder).
// Metadata: the Next.js type for page title/description data.
import type { Metadata } from "next";
// Score settings shared with the real calculation (packages/core/src/score.ts):
// CREDIBILITY_POINTS (points per fact on record), GRADES (letter grades and their lowest score),
// MIN_PRICE_PEERS (providers needed before price is compared), MIN_REVIEWS (reviews before a score stops
// being "provisional"), PRIOR_RATING / PRIOR_WEIGHT (the imaginary starting reviews), SCORE_WEIGHTS (how
// the parts are mixed, as fractions such as 0.6).
import { CREDIBILITY_POINTS, GRADES, MIN_PRICE_PEERS, MIN_REVIEWS, PRIOR_RATING, PRIOR_WEIGHT, SCORE_WEIGHTS } from "@fundhub/core/score";
// Our marketing design pieces: CheckList (bullet list), CtaBand (dark call-to-action strip with buttons),
// Panel (bordered box), SectionTitle (heading with eyebrow label and intro).
import { CheckList, CtaBand, Panel, SectionTitle } from "@/components/marketing";

/** Kind: constant (Next.js metadata). Tab title "FundHub Score · FundHub" plus description. */
export const metadata: Metadata = {
  title: "FundHub Score",
  description: "How FundHub grades Luxembourg fund service providers on quality and price: an independent 0–100 score that providers cannot buy.",
};

/**
 * Kind: constant holding an arrow function.
 * @param n  type `number` — a fraction, e.g. 0.6.
 * @returns  `string` — the same as a rounded percentage, e.g. "60%". `Math.round` rounds to a whole number.
 */
const pct = (n: number) => `${Math.round(n * 100)}%`;

/**
 * Kind: React component (server component) — the page. Takes no parameters.
 * @returns JSX: the explanation sections and a call-to-action band.
 */
export default function FundHubScorePage() {
  // Tailwind: `max-w-4xl` limits width; `space-y-8` puts large gaps between sections.
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="Provider Comparator"
        title="The FundHub Score"
        lead="One independent grade from 0 to 100 for every provider, combining quality and price. It is computed only from FundHub's own data, and the formula is public. Providers cannot pay to improve it."
      />

      {/* Three boxes side by side from medium screens (`md:grid-cols-3`), stacked on phones.
          `{pct(SCORE_WEIGHTS.quality)}` runs our pct function and shows e.g. "60%" in the text.
          `text-[11px]` is a Tailwind "arbitrary value": exactly 11 pixels. */}
      <section className="grid gap-4 md:grid-cols-3">
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">FundHub Score</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            {pct(SCORE_WEIGHTS.quality)} Quality Score + {pct(SCORE_WEIGHTS.price)} Price Score. When a category has fewer than {MIN_PRICE_PEERS} providers,
            fees can&apos;t be compared fairly and the score equals the Quality Score.
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Quality Score</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            {pct(SCORE_WEIGHTS.peer)} verified peer reviews + {pct(SCORE_WEIGHTS.credibility)} data credibility.
          </p>
        </Panel>
        <Panel>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Price Score</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            The share of providers in the same category whose typical quarterly fee is higher. 100 means the most affordable of its peers, 0 the most
            expensive.
          </p>
        </Panel>
      </section>

      <section className="space-y-3">
        <h2 className="text-base font-semibold text-ink">Grades</h2>
        <div className="flex flex-wrap gap-2">
          {/* One chip per grade. GRADES is ordered from best (A+) down, so for each grade `g` at position `i`:
              - the first one (i === 0) has no upper limit, shown as e.g. "85+";
              - every other one runs from its own minimum up to one below the previous grade's minimum,
                e.g. A = "75–84". `GRADES[i - 1]` is the item just before it in the list. */}
          {GRADES.map((g, i) => (
            <span key={g.grade} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm">
              <strong className="text-ink">{g.grade}</strong>{" "}
              <span className="tnum text-slate-500">{i === 0 ? `${g.min}+` : `${g.min}–${GRADES[i - 1].min - 1}`}</span>
            </span>
          ))}
        </div>
      </section>

      {/* Two columns from medium screens up: how peer reviews and data credibility are scored. */}
      <section className="grid gap-6 md:grid-cols-2">
        <div>
          <h2 className="text-base font-semibold text-ink">Peer reviews (inside Quality)</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            The average overall rating from verified client reviews, scaled to 0–100. To stop a single review from deciding a ranking, each provider
            starts as if it had {PRIOR_WEIGHT} reviews of {PRIOR_RATING}★, and real reviews progressively replace that starting point. Scores with fewer
            than {MIN_REVIEWS} reviews are marked <em>provisional</em>.
          </p>
        </div>
        <div>
          <h2 className="text-base font-semibold text-ink">Data credibility (inside Quality)</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink-600">
            Facts on record only. The FundHub Verified badge doesn&apos;t count, because verification is part of a paid subscription.
          </p>
          {/* The list items are template strings, so the point values come straight from CREDIBILITY_POINTS. */}
          <CheckList
            items={[
              `${CREDIBILITY_POINTS.licensed} points: at least one CSSF / professional licence on record`,
              `${CREDIBILITY_POINTS.certified} points: at least one certification (e.g. ISAE 3402, ISO 27001)`,
              `${CREDIBILITY_POINTS.fresh} points: profile verified or updated in the last 12 months`,
            ]}
          />
        </div>
      </section>

      {/* Dashed box listing what the score is not; `tone="negative"` gives the bullets a red dot. */}
      <Panel className="space-y-2 border-dashed">
        <h2 className="text-sm font-semibold text-ink">What the score is not</h2>
        <CheckList
          tone="negative"
          items={[
            "Not paid for: subscriptions, verification and advertising have no effect on any score.",
            "Not a recommendation for your specific fund: use it to shortlist, then compare proposals like for like.",
            "Not a fee quote: Price Score uses indicative ranges, and your mandate may price differently.",
          ]}
        />
      </Panel>

      {/* Call-to-action strip. `primary` and `secondary` are objects with a link address and a button label. */}
      <CtaBand
        title="Shortlist by FundHub Score"
        body="Sort the comparator by FundHub, Quality or Price Score, or see the top providers per category."
        primary={{ href: "/compare?sort=score", label: "Open the comparator" }}
        secondary={{ href: "/benchmarks#rankings", label: "See rankings" }}
      />
    </main>
  );
}
