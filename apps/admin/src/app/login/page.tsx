import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-forms";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Login" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const s = await getSession();
  if (s?.mfaPassed) redirect("/");
  return <LoginForm resetDone={(await searchParams).reset === "1"} />;
}
