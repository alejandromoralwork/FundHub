import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResetForm } from "@/components/account-forms";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) redirect("/login/forgot");
  return <ResetForm token={token} />;
}
