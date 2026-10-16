import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Crown, Lock } from "lucide-react";
import { CheckList, Panel, SectionTitle } from "@/components/marketing";
import { RequestForm } from "@/components/request-form";
import { canAccessPrivateReports, getCurrentUser, hasDataMembership } from "@/lib/auth/session";
import { membershipPrice, membershipStripe } from "@/lib/membership";
import { startMembershipCheckout } from "@/lib/membership-actions";
import { listProviderOptions } from "@fundhub/db/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Data Intelligence membership",
  description: "Become a FundHub member to unlock private Data Intelligence reports on Luxembourg fund service providers and fees.",
};

const INTERVAL: Record<string, string> = { month: "month", year: "year", week: "week", day: "day" };

/** "€1,200 / year", read from the Stripe price so the page never shows a stale amount. */
async function priceLabel(): Promise<string | null> {
  const stripe = membershipStripe();
  if (!stripe) return null;
  try {
    const p = await stripe.prices.retrieve(membershipPrice()!);
    if (p.unit_amount == null) return null;
    const amount = new Intl.NumberFormat("en-GB", { style: "currency", currency: p.currency.toUpperCase(), maximumFractionDigits: 0 }).format(p.unit_amount / 100);
    const r = p.recurring;
    const every = r ? (r.interval === "month" && r.interval_count === 3 ? "quarter" : `${r.interval_count > 1 ? `${r.interval_count} ` : ""}${INTERVAL[r.interval]}`) : "";
    return `${amount}${every ? ` / ${every}` : ""} excl. VAT`;
  } catch (err) {
    console.error("Failed to load membership price", err);
    return null;
  }
}

export default async function MembershipPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const user = await getCurrentUser();
  const [member, access, price, providers] = await Promise.all([hasDataMembership(user), canAccessPrivateReports(user), priceLabel(), listProviderOptions()]);
  const checkoutReady = !!membershipStripe();

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="Data Intelligence · Membership"
        title="Unlock FundHub's private reports"
        lead="Public reports and live statistics stay free for everyone. Members also get the private reports: deeper analysis of Luxembourg fund service providers, fees and market shares, built from FundHub's independent data."
      />

      {status === "success" && (
        <p className="flex items-center gap-2 rounded-md bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          <CheckCircle2 className="h-4 w-4" /> Payment received, thank you. Your access is activated within a minute; refresh the{" "}
          <Link href="/data-intelligence#reports" className="font-semibold underline">
            reports
          </Link>{" "}
          if they still show as locked.
        </p>
      )}
      {status === "cancelled" && <p className="rounded-md bg-slate-100 px-4 py-3 text-sm text-ink-600">Checkout cancelled. Nothing was charged.</p>}

      <section className="grid gap-6 lg:grid-cols-5">
        <Panel className="space-y-4 border-emerald/40 lg:col-span-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Crown className="h-4 w-4 text-emerald" /> Member benefits
          </p>
          <CheckList
            items={[
              "All private PDF reports, including the quarterly Provider Intelligence Report",
              "New private reports as soon as they are published",
              "Downloads under your own account, with invoices including Luxembourg VAT",
              "Independent: memberships never influence rankings, scores or advice",
            ]}
          />
          <p className="text-xs text-slate-500">
            Service providers with an approved company profile already get private reports included.
          </p>
        </Panel>

        <Panel className="flex flex-col justify-between gap-4 lg:col-span-2">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Membership</p>
            <p className="mt-1 text-2xl font-semibold text-ink">{price ?? "Pricing on request"}</p>
          </div>
          {member ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="h-4 w-4" /> You&apos;re a member.{" "}
              <Link href="/data-intelligence#reports" className="underline">
                Open the reports
              </Link>
            </p>
          ) : access ? (
            <p className="text-sm text-ink-600">
              Your provider account already includes private reports.{" "}
              <Link href="/data-intelligence#reports" className="font-medium text-emerald-700 underline">
                Open the reports
              </Link>
            </p>
          ) : checkoutReady ? (
            <form action={startMembershipCheckout}>
              <button className="w-full rounded-md bg-emerald px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">
                {user ? "Become a member" : "Log in to become a member"}
              </button>
              <p className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-400">
                <Lock className="h-3 w-3" /> Secure payment by Stripe. Cancel anytime.
              </p>
            </form>
          ) : (
            <Link href="#contact" className="rounded-md bg-emerald px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-emerald-700">
              Ask for membership
            </Link>
          )}
        </Panel>
      </section>

      {!checkoutReady && !member && (
        <section id="contact" className="scroll-mt-20 space-y-3">
          <h2 className="text-base font-semibold text-ink">Request membership</h2>
          <p className="text-sm text-ink-600">Tell us who you are and we&apos;ll send the membership terms.</p>
          <RequestForm requestType="data" providers={providers} />
        </section>
      )}
    </main>
  );
}
