import type { Metadata } from "next";
import { CREDIBILITY_POINTS, GRADES, MIN_PRICE_PEERS, MIN_REVIEWS, PRIOR_RATING, PRIOR_WEIGHT, SCORE_WEIGHTS } from "@fundhub/core/score";
import { CheckList, CtaBand, Panel, SectionTitle } from "@/components/marketing";

export const metadata: Metadata = {
  title: "FundHub Score",
  description: "How FundHub grades Luxembourg fund service providers on quality and price: an independent 0–100 score that providers cannot buy.",
};

const pct = (n: number) => `${Math.round(n * 100)}%`;

export default function FundHubScorePage() {
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-8 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="Provider Comparator"
        title="The FundHub Score"
        lead="One independent grade from 0 to 100 for every provider, combining quality and price. It is computed only from FundHub's own data, and the formula is public. Providers cannot pay to improve it."
      />

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
          {GRADES.map((g, i) => (
            <span key={g.grade} className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm">
              <strong className="text-ink">{g.grade}</strong>{" "}
              <span className="tnum text-slate-500">{i === 0 ? `${g.min}+` : `${g.min}–${GRADES[i - 1].min - 1}`}</span>
            </span>
          ))}
        </div>
      </section>

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
          <CheckList
            items={[
              `${CREDIBILITY_POINTS.verified} points: FundHub Verified (RCS, CSSF and DDQ checks)`,
              `${CREDIBILITY_POINTS.licensed} points: at least one CSSF / professional licence on record`,
              `${CREDIBILITY_POINTS.certified} points: at least one certification (e.g. ISAE 3402, ISO 27001)`,
              `${CREDIBILITY_POINTS.fresh} points: profile verified or updated in the last 12 months`,
            ]}
          />
        </div>
      </section>

      <Panel className="space-y-2 border-dashed">
        <h2 className="text-sm font-semibold text-ink">What the score is not</h2>
        <CheckList
          tone="negative"
          items={[
            "Not paid for: subscriptions, advertising and Pro plans have no effect on any score.",
            "Not a recommendation for your specific fund: use it to shortlist, then compare proposals like for like.",
            "Not a fee quote: Price Score uses indicative ranges, and your mandate may price differently.",
          ]}
        />
      </Panel>

      <CtaBand
        title="Shortlist by FundHub Score"
        body="Sort the comparator by FundHub, Quality or Price Score, or see the top providers per category."
        primary={{ href: "/compare?sort=score", label: "Open the comparator" }}
        secondary={{ href: "/benchmarks#rankings", label: "See rankings" }}
      />
    </main>
  );
}
