import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Provider login", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (await getCurrentUser()) redirect(next?.startsWith("/") ? next : "/account");

  return (
    <main className="mx-auto w-full max-w-md flex-1 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Service provider login</h1>
      <p className="mt-1 mb-5 text-sm text-ink-600">
        For fund service providers managing their FundHub profile. Visitors don&apos;t need an account to compare
        providers.
      </p>
      <AuthForm mode="login" next={next} />
    </main>
  );
}
