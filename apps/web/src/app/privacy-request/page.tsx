import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY } from "@fundhub/core/company";
import { GdprForm } from "@/components/gdpr-form";

export const metadata: Metadata = { title: "Data request", description: "Access, correct or delete your personal data held by FundHub." };

export default function PrivacyRequestPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Your data, your rights</h1>
      <p className="text-sm leading-relaxed text-ink-600">
        Ask for a copy of the personal data FundHub holds about you, have it corrected or deleted, or object to how we use it.
        We confirm the request by email and answer within one month. See our{" "}
        <Link href="/legal/privacy" className="font-medium text-emerald-700 hover:underline">
          privacy policy
        </Link>{" "}
        or write to {COMPANY.privacyEmail}.
      </p>
      <GdprForm />
    </main>
  );
}
