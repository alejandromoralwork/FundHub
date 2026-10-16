import type { Metadata } from "next";
import { Award, BadgeCheck, BarChart3, CheckCircle2, PenLine } from "lucide-react";
import { ButtonLink, Panel, SectionTitle } from "@/components/marketing";

export const metadata: Metadata = {
  title: "For service providers",
  description:
    "Every Luxembourg fund service provider is listed on FundHub for free. Claim your profile, subscribe to get the FundHub Verified audit and market data, and compete on merit.",
};

const TIERS = [
  {
    name: "Free listing",
    who: "Every active provider",
    features: [
      "Profile in the comparator and category guides",
      "Free public market statistics",
      "Receive RFIs from asset managers",
      "Correct factual errors on request",
    ],
  },
  {
    name: "Pro · Boutique",
    who: "Small law firms, niche tax advisers, HR and IT consultants",
    features: [
      "FundHub Verified audit (badge granted on a pass)",
      "Direct control of services, headcount, stack and client milestones",
      "Quarterly 'Local Fee Distribution' report",
      "RFI analytics for your categories",
    ],
  },
  {
    name: "Pro · Mid-Market",
    who: "Specialised fund administrators, third-party AIFMs",
    features: [
      "Everything in Boutique",
      "'Top 10 High-Growth Services Requested' report",
      "Competitor software penetration metrics",
    ],
  },
  {
    name: "Pro · Institutional",
    who: "Global custodians, depositary banks, large law and audit firms",
    features: [
      "Everything in Mid-Market",
      "Multi-entity and multi-category profiles",
      "Dedicated data-relations contact",
    ],
  },
];

export default function ForProvidersPage() {

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-12 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="For service providers"
        title="Compete on merit, not on referral networks"
        lead="Luxembourg's fund services market has long run on word of mouth, which locks out specialised, cost-effective providers. FundHub lists every active provider for free and puts them in front of asset managers on objective data: services, technology, scale, reviews and price."
      />

      <section className="grid gap-4 md:grid-cols-3">
        <Panel>
          <BadgeCheck className="h-5 w-5 text-emerald" />
          <h2 className="mt-3 text-sm font-semibold text-ink">FundHub Verified</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
            We check your RCS and RESA filings, CSSF authorisations and a short management DDQ (tech stack, headcount,
            certifications). The audit is included in every subscription, but the badge is granted only if you pass, and re-checked twice a year. It never changes your score or ranking.
          </p>
        </Panel>
        <Panel>
          <PenLine className="h-5 w-5 text-emerald" />
          <h2 className="mt-3 text-sm font-semibold text-ink">Profile control with Pro</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
            Pro accounts manage their own service scope, headcount, client milestones and software stack, and receive
            anonymized market-intelligence reports every quarter.
          </p>
        </Panel>
        <Panel>
          <Award className="h-5 w-5 text-emerald" />
          <h2 className="mt-3 text-sm font-semibold text-ink">FundHub Market Awards</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
            An annual, peer-review-driven awards programme, e.g. &ldquo;Specialised AIFM Administrator of the
            Year&rdquo;. Results are based on verified client feedback and an independent jury.
          </p>
        </Panel>
      </section>

      <section>
        <SectionTitle
          eyebrow="Plans"
          title="Listing is free. Subscriptions pay for verification and data, never visibility."
          lead="Subscriptions are annual contracts billed quarterly and priced by provider size. They include the verification audit and Data Intelligence, and never affect rankings, scores or reviews."
        />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {TIERS.map((t, i) => (
            <div
              key={t.name}
              className={
                i === 0
                  ? "rounded-lg border-2 border-emerald bg-white p-5"
                  : "rounded-lg border border-slate-200 bg-white p-5"
              }
            >
              <p className="text-sm font-semibold text-ink">{t.name}</p>
              <p className="mt-0.5 text-xs text-slate-500">{t.who}</p>
              <p className="mt-3 text-lg font-semibold text-ink">{i === 0 ? "Free" : "On request"}</p>
              <ul className="mt-3 space-y-2">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2 text-xs leading-relaxed text-ink-600">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald" />
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <Panel>
          <BarChart3 className="h-5 w-5 text-emerald" />
          <h2 className="mt-3 text-sm font-semibold text-ink">Quarterly intelligence reports</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-600">
            Anonymized, aggregated insight from the FundHub platform, for example:
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-600">
            <li>Local fee distribution by category and provider type</li>
            <li>Top 10 high-growth fund services requested</li>
            <li>Competitor software penetration metrics</li>
          </ul>
          <p className="mt-2 text-xs text-slate-500">Reports never identify individual buyers or RFIs.</p>
        </Panel>
        <Panel>
          <h2 className="text-sm font-semibold text-ink">How your profile is built</h2>
          <dl className="mt-3 space-y-2.5 text-sm">
            {[
              ["Legal & status", "RCS / RESA, refreshed every 48 hours"],
              ["Regulatory licences", "CSSF registers, synchronized weekly"],
              ["Tech stack & headcount", "Management DDQ, validated twice a year"],
              ["Fees & reviews", "RFI and audit pools; closed peer-review loop"],
              ["Your self-edits", "Live immediately, logged, shown as provider-updated"],
            ].map(([k, v]) => (
              <div key={k} className="flex flex-col sm:flex-row sm:gap-4">
                <dt className="w-44 shrink-0 font-medium text-ink">{k}</dt>
                <dd className="text-ink-600">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </section>

      <section id="contact" className="scroll-mt-20 rounded-xl bg-ink-900 px-6 py-8 text-white sm:px-10">
        <h2 className="text-xl font-semibold">Manage your company profile</h2>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-slate-300">
          Create a free provider account, claim your listing and keep your services, team, tech stack and clients up to
          date yourself. Approved accounts also get the private Data Intelligence reports.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <ButtonLink href="/account/signup?type=provider">Create a provider account</ButtonLink>
          <ButtonLink href="/account/login" variant="ghost">
            Log in
          </ButtonLink>
          <ButtonLink href="/awards#nominate" variant="ghost">
            FundHub Awards
          </ButtonLink>
        </div>
      </section>
    </main>
  );
}
