import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

const BENEFITS = {
  visitor: [
    "Save providers to your shortlist",
    "Write verified reviews of providers you work with",
    "Get the quarterly market snapshot and sector news",
  ],
  provider: [
    "Claim your company's listing, or propose a new one",
    "FundHub confirms you represent the company (usually within 2 business days)",
    "Keep your services, team, tech stack and clients up to date yourself",
    "Download the private Data Intelligence reports",
  ],
};

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; type?: string }> }) {
  const { next, type } = await searchParams;
  if (await getCurrentUser()) redirect("/account");

  return (
    <main className="mx-auto grid w-full max-w-4xl flex-1 gap-6 p-4 sm:p-6 md:grid-cols-2">
      <div>
        <h1 className="text-xl font-semibold text-ink">Create a free FundHub account</h1>
        <p className="mt-1 text-sm text-ink-600">Two kinds of account, one login.</p>
        {(["visitor", "provider"] as const).map((k) => (
          <div key={k} className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {k === "visitor" ? "Fund managers & visitors" : "Service providers"}
            </p>
            <ul className="mt-2 space-y-1.5">
              {BENEFITS[k].map((b) => (
                <li key={b} className="flex gap-2 text-sm text-ink-600">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald" /> {b}
                </li>
              ))}
            </ul>
          </div>
        ))}
        <p className="mt-5 rounded-md bg-canvas p-3 text-xs leading-relaxed text-ink-600">
          Providers control their factual data. Fee ranges, peer scores, reviews and the Verified badge stay under
          FundHub&apos;s independent control.
        </p>
      </div>
      <AuthForm mode="signup" next={next} defaultType={type === "provider" ? "provider" : "visitor"} />
    </main>
  );
}
