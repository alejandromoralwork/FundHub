import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "@/components/auth-form";

export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-md flex-1 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Choose a new password</h1>
      {token ? (
        <div className="mt-5">
          <ResetPasswordForm token={token} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-600">
          This link is incomplete.{" "}
          <Link href="/account/forgot" className="text-emerald-700 hover:underline">
            Request a new reset link
          </Link>
          .
        </p>
      )}
    </main>
  );
}
