import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Create a provider account", robots: { index: false } };

const STEPS = [
  "Create your account",
  "Claim your company's listing, or propose a new one",
  "FundHub confirms you represent the company (usually within 2 business days)",
  "Keep your services, team, tech stack and clients up to date yourself",
];

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect("/account");

  return (
    <main className="mx-auto grid w-full max-w-4xl flex-1 gap-6 p-4 sm:p-6 md:grid-cols-2">
      <div>
        <h1 className="text-xl font-semibold text-ink">Create a provider account</h1>
        <p className="mt-1 text-sm text-ink-600">
          Free for every Luxembourg fund service provider. Manage your company&apos;s profile and access private Data
          Intelligence reports.
        </p>
        <ol className="mt-5 space-y-3">
          {STEPS.map((s, i) => (
            <li key={s} className="flex gap-3 text-sm text-ink-600">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-50 font-mono text-xs text-emerald-700">
                {i + 1}
              </span>
              {s}
            </li>
          ))}
        </ol>
        <p className="mt-5 flex gap-2 rounded-md bg-canvas p-3 text-xs leading-relaxed text-ink-600">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald" />
          You control factual data. Fee ranges, peer scores, reviews and the Verified badge stay under FundHub&apos;s
          independent control.
        </p>
      </div>
      <AuthForm mode="signup" next={next} />
    </main>
  );
}
