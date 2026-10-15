import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto w-full max-w-md flex-1 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Forgot your password?</h1>
      <p className="mt-1 mb-5 text-sm text-ink-600">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      <ForgotPasswordForm />
      <p className="mt-4 text-center text-xs">
        <Link href="/account/login" className="text-emerald-700 hover:underline">
          Back to login
        </Link>
      </p>
    </main>
  );
}
