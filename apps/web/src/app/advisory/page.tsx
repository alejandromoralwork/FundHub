import type { Metadata } from "next";
import { Ban, Coins, FileSearch, Handshake, Map as MapIcon, ShieldCheck, Users } from "lucide-react";
import { CheckList, Panel, SectionTitle } from "@/components/marketing";
import { RequestForm } from "@/components/request-form";
import { listProviderOptions } from "@fundhub/db/queries";
import { ADVISORY_SERVICES } from "@fundhub/core/request-options";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Independent advisory",
  description:
    "We accompany asset managers to negotiate fees with Luxembourg fund service providers and help them set up their activities. Paid only by you, never by providers.",
};

const ICONS = { "fee-audit": FileSearch, "vendor-selection": Users, negotiation: Handshake, "fund-setup": MapIcon } as const;

const PROCESS = [
  { title: "Scoping call", body: "A free 30-minute call about your project: a new fund or activity, a renegotiation, or proposals you've received." },
  {
    title: "Data-driven diagnosis",
    body: "We benchmark your fees and scope against FundHub's market data and anonymized RFI and audit pools.",
  },
  {
    title: "Negotiation, with you in the room",
    body: "We prepare the negotiation, run a standardized RFP if needed, and attend the pricing meetings with you, physically or virtually.",
  },
  {
    title: "Set-up & onboarding",
    body: "We coordinate the set-up of your activities and providers in Luxembourg and accompany you through contracts and onboarding.",
  },
];

const FAQ = [
  {
    q: "Do you receive anything from the provider we choose?",
    a: "No. FundHub accepts no referral fees, commissions, retrocessions or reciprocal business from service providers. We confirm this in writing in every engagement letter.",
  },
  {
    q: "How is the success fee calculated?",
    a: "As a percentage of the first-year savings we capture against your baseline (your current fees or the best initial quote). The baseline and percentage are agreed before we start.",
  },
  {
    q: "Will you recommend providers that pay for a FundHub Pro account?",
    a: "Subscriptions have no influence on our advice, rankings, scores or the Verified badge. Shortlists are built from the full index using the criteria you set.",
  },
  {
    q: "We already have providers. Is an audit still worthwhile?",
    a: "Yes. Fee schedules drift through indexation, add-on services and changed scope. A retrospective invoice audit often finds savings without changing providers.",
  },
];

export default async function AdvisoryPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; provider?: string }>;
}) {
  const { service, provider } = await searchParams;
  const providers = await listProviderOptions();
  const preselected = providers.find((p) => p.slug === provider);
  const preService = ADVISORY_SERVICES.find((s) => s.id === service);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-12 p-4 sm:p-6">
      <section className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionTitle
            as="h1"
            eyebrow="Advisory"
            title="We go with you to the negotiating table, and help you set up in Luxembourg"
            lead="Two things managers ask us for most: someone experienced on their side when negotiating fees with service providers, and a guide through setting up their fund and activities in Luxembourg. Law firms and administrators often recommend providers under referral fees; we don't. Our senior experts work only for you, backed by FundHub's market data."
          />
        </div>
        <Panel className="border-emerald/40 lg:col-span-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldCheck className="h-4 w-4 text-emerald" /> Conflict-free mandate
          </p>
          <ul className="mt-3 space-y-2.5 text-sm text-ink-600">
            <li className="flex gap-2">
              <Coins className="mt-0.5 h-4 w-4 shrink-0 text-emerald" />
              <span>
                <strong className="text-ink">Flat advisory fee</strong> agreed up front, or
              </span>
            </li>
            <li className="flex gap-2">
              <Coins className="mt-0.5 h-4 w-4 shrink-0 text-emerald" />
              <span>
                <strong className="text-ink">Success fee</strong>: a percentage of the savings we capture.
              </span>
            </li>
            <li className="flex gap-2">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <span>
                <strong className="text-ink">Zero</strong> referral fees, commissions or kickbacks from providers.
              </span>
            </li>
          </ul>
        </Panel>
      </section>

      <section>
        <SectionTitle eyebrow="Services" title="What we do for asset managers" lead="Negotiation support and set-up support are our core services; fee audits and RFP management support both." />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {ADVISORY_SERVICES.map((s) => {
            const Icon = ICONS[s.id];
            return (
              <Panel key={s.id}>
                <Icon className="h-5 w-5 text-emerald" />
                <h3 className="mt-3 text-sm font-semibold text-ink">{s.label}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{s.description}</p>
                <a href={`/advisory?service=${s.id}#contact`} className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:underline">
                  Request this service →
                </a>
              </Panel>
            );
          })}
        </div>
      </section>

      <section>
        <SectionTitle eyebrow="Process" title="How an engagement works" />
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PROCESS.map((p, i) => (
            <li key={p.title} className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="font-mono text-xs text-emerald-700">0{i + 1}</p>
              <h3 className="mt-1 text-sm font-semibold text-ink">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{p.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle eyebrow="What our audits typically find" title="Where the money leaks" />
          <div className="mt-4">
            <CheckList
              tone="negative"
              items={[
                "Hidden per-SPV, per-investor and per-transaction line items",
                "Inflated out-of-pocket and 'technology' expenses",
                "Services bundled in that the fund doesn't need",
                "Minimum fees and indexation clauses out of line with the market",
                "Depositary or administration bundles priced above unbundled alternatives",
              ]}
            />
          </div>
        </div>
        <div>
          <SectionTitle eyebrow="FAQ" title="Common questions" />
          <dl className="mt-4 space-y-4">
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt className="text-sm font-semibold text-ink">{f.q}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-ink-600">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section id="contact" className="scroll-mt-20">
        <SectionTitle
          eyebrow="Get started"
          title="Request a free scoping call"
          lead="Tell us about your fund and what you need. Requests are confidential and never shared with service providers."
        />
        <div className="mt-5 max-w-3xl">
          <RequestForm
            requestType="advisory"
            providers={providers}
            defaultProviderId={preselected?.id}
            defaultServices={preService ? [preService.label] : []}
          />
        </div>
      </section>
    </main>
  );
}
