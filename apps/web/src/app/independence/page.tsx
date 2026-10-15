import type { Metadata } from "next";
import { Ban, CheckCircle2, Coins, ShieldCheck } from "lucide-react";
import { CtaBand, Panel, SectionTitle } from "@/components/marketing";

export const metadata: Metadata = {
  title: "Independence charter",
  description:
    "How FundHub stays independent: no referral fees, no commissions, rankings that can't be bought, and reviews uncoupled from provider spend.",
};

const NEVER = [
  "Accept referral fees, finder's fees, commissions or retrocessions from service providers",
  "Enter reciprocal 'you send me, I send you' arrangements with law firms, administrators or consultants",
  "Sell ranking positions, sponsored placements or 'featured' slots in the comparator",
  "Let a subscription influence a Peer Opinion Score, a fee benchmark or the Verified badge",
  "Share a buyer's identity or request with providers without the buyer's consent",
  "Publish reviews from unauthenticated reviewers or delete negative reviews on request",
];

const REVENUE = [
  {
    who: "Asset managers (buy-side)",
    what: "Independent advisory: fee audits, vendor selection and negotiation representation.",
    how: "Flat advisory fee or a percentage of the savings we capture. This is our only income linked to a provider decision, and it's paid by the buyer.",
  },
  {
    who: "Service providers",
    what: "Optional Pro accounts: control over profile data (services, headcount, tech stack, client milestones) and anonymized quarterly market-intelligence reports.",
    how: "Annual subscription billed quarterly. It buys no visibility, ranking, score or badge, and listing is always free.",
  },
  {
    who: "Industry",
    what: "FundHub Market Awards and research reports.",
    how: "Award categories are decided by peer-review data and an independent jury. Participation fees cover auditing and never decide the outcome.",
  },
];

const RANKING = [
  ["Default order", "Peer Opinion Score, then number of verified reviews"],
  ["Peer Opinion Score", "Average rating from authenticated asset managers in a closed, double-blind review loop"],
  ["Fee ranges", "Empirical quarterly fees from RFI responses, fee audits and provider disclosures, cross-checked"],
  ["FundHub Verified", "Free data check against RCS, RESA, CSSF registers and a management DDQ; open to every provider"],
];

export default function IndependencePage() {
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-12 p-4 sm:p-6">
      <section>
        <SectionTitle
          as="h1"
          eyebrow="Independence charter"
          title="Independence is the product"
          lead="Luxembourg's gatekeepers (law firms, tax advisers, consultants and even fund administrators) often recommend service providers under pre-agreed referral fees or reciprocal deals. That conflict of interest funnels managers into pre-selected partnerships and keeps prices high. FundHub exists to be the alternative, so these are the commitments we hold ourselves to."
        />
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Panel className="border-red-200">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Ban className="h-4 w-4 text-red-500" /> What FundHub never does
          </h2>
          <ul className="mt-3 space-y-2.5">
            {NEVER.map((n) => (
              <li key={n} className="flex gap-2 text-sm leading-relaxed text-ink-600">
                <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
                {n}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel className="border-emerald/40">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldCheck className="h-4 w-4 text-emerald" /> What FundHub always does
          </h2>
          <ul className="mt-3 space-y-2.5">
            {[
              "Lists every active provider for free, from boutique to institutional",
              "Discloses how every score, range and badge is computed (see Methodology)",
              "Confirms in writing, in every advisory engagement, that we take no provider remuneration",
              "Builds shortlists from the full index using the buyer's own criteria",
              "Lets providers correct factual data, but never their scores or reviews",
              "Discloses any conflict of interest of our staff before an engagement starts",
            ].map((n) => (
              <li key={n} className="flex gap-2 text-sm leading-relaxed text-ink-600">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald" />
                {n}
              </li>
            ))}
          </ul>
        </Panel>
      </section>

      <section>
        <SectionTitle
          eyebrow="Follow the money"
          title="How FundHub earns revenue"
          lead="Full transparency on who pays us and what they get, and what they don't."
        />
        <div className="mt-5 overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-canvas text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2.5">Who pays</th>
                <th className="px-4 py-2.5">For what</th>
                <th className="px-4 py-2.5">How, and the limits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 align-top">
              {REVENUE.map((r) => (
                <tr key={r.who}>
                  <td className="px-4 py-3 font-medium text-ink">
                    <span className="flex items-center gap-1.5">
                      <Coins className="h-3.5 w-3.5 text-emerald" /> {r.who}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-ink-600">{r.what}</td>
                  <td className="px-4 py-3 text-ink-600">{r.how}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="Rankings" title="How the comparator orders providers" />
        <dl className="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
          {RANKING.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:gap-6">
              <dt className="w-48 shrink-0 text-sm font-medium text-ink">{k}</dt>
              <dd className="text-sm text-ink-600">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <SectionTitle
          eyebrow="Ask your adviser"
          title="Four questions to test any recommendation"
          lead="Whoever recommends a service provider to you, FundHub included, should be able to answer these in writing."
        />
        <ol className="mt-4 grid gap-3 sm:grid-cols-2">
          {[
            "Do you or your firm receive any fee, commission or benefit if we appoint this provider?",
            "Do you have a reciprocal referral relationship with them?",
            "Which other providers did you consider, and why were they excluded?",
            "What fee benchmarks is your recommendation based on?",
          ].map((q, i) => (
            <li key={q} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm text-ink-600">
              <span className="font-mono text-xs text-emerald-700">0{i + 1}</span>
              {q}
            </li>
          ))}
        </ol>
      </section>

      <CtaBand
        title="Get an independent second opinion"
        body="Already received a recommendation or a proposal? We'll benchmark it against the market, with nothing to gain from your choice."
        primary={{ href: "/advisory?service=fee-audit#contact", label: "Request a fee audit" }}
        secondary={{ href: "/compare", label: "Compare providers" }}
      />
    </main>
  );
}
