import type { Metadata } from "next";
import Link from "next/link";
import { Building2, CalendarClock, Landmark, Scale, Users, Wallet } from "lucide-react";
import { CheckList, Panel, SectionTitle } from "@/components/marketing";
import { RequestForm } from "@/components/request-form";
import { listProviderOptions } from "@fundhub/db/queries";
import { ADVISORY_SERVICES } from "@fundhub/core/request-options";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Fund set-up advisory",
  description:
    "Independent support to set up a fund or management activity in Luxembourg: structure, required providers, budget, substance and timeline. Paid only by you.",
};

const SETUP = ADVISORY_SERVICES.find((s) => s.id === "fund-setup")!;

const AREAS = [
  { icon: Scale, title: "Structure", body: "Comparing the options (e.g. RAIF, SIF, SICAV, SCSp) against your strategy, investors and distribution plans, together with your legal counsel." },
  { icon: Landmark, title: "Required providers", body: "Which providers the structure legally needs (AIFM or ManCo, depositary, administrator, auditor, domiciliation) and a conflict-free shortlist for each." },
  { icon: Wallet, title: "Realistic budget", body: "Set-up and running costs built from FundHub's fee benchmarks, so you know the total expense ratio before you commit." },
  { icon: Building2, title: "Substance", body: "Office, local directors, staff and governance that meet CSSF expectations without overbuilding." },
  { icon: CalendarClock, title: "Timeline", body: "A realistic plan from first call to first closing, including CSSF approval where needed and provider onboarding." },
  { icon: Users, title: "Onboarding", body: "We coordinate KYC, contracts and service-level agreements across providers, and attend kick-off meetings with you." },
];

export default async function FundSetupPage() {
  const providers = await listProviderOptions();
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-10 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="Advisory · Fund set-up"
        title="Set up your fund or activity in Luxembourg, with an independent guide"
        lead="Launching a first fund, adding a new strategy or moving activities to Luxembourg means choosing a structure and several providers at once. We coordinate the whole set-up on your side, with no referral fees from anyone we recommend."
      />

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AREAS.map(({ icon: Icon, title, body }) => (
          <Panel key={title}>
            <Icon className="h-5 w-5 text-emerald" />
            <h2 className="mt-2 text-sm font-semibold text-ink">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">{body}</p>
          </Panel>
        ))}
      </section>

      <section className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-base font-semibold text-ink">How we work</h2>
          <CheckList
            items={[
              "Fixed fee per phase, agreed before we start. Paid only by you.",
              "We work alongside your legal counsel; we don't replace legal or tax advice.",
              "Every provider shortlist comes from the full FundHub index, ranked with the public FundHub Score.",
              "No referral fees, commissions or retrocessions from any provider, confirmed in writing.",
            ]}
          />
          <p className="text-sm text-ink-600">
            Already set up and want better terms?{" "}
            <Link href="/advisory" className="font-medium text-emerald-700 hover:underline">
              Provider selection & fee negotiation
            </Link>
            .
          </p>
        </div>
        <div id="contact" className="scroll-mt-20 lg:col-span-3">
          <RequestForm requestType="advisory" providers={providers} defaultServices={[SETUP.label]} />
        </div>
      </section>
    </main>
  );
}
