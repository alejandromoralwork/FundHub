/**
 * FILE: apps/admin/src/app/login/new-password/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The forced "Choose your password" step. After a new account or a password reset (by an owner
 *   on the Staff page or with `npm run staff`), the next login lands here after the two-factor code and cannot
 *   reach any other page until the person sets their own password (requireStaff redirects here).
 * WHERE IT RUNS: on the server (checks the session); the form runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/login/new-password = the URL /admin/login/new-password.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FirstPasswordForm } from "@/components/account-forms";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choose your password" };

/**
 * Kind: React component (async server component) — the page.
 * @returns `Promise<JSX>`: the form, or a redirect when it does not apply.
 */
export default async function NewPasswordPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.mfaPassed) redirect("/login/mfa");
  if (!s.staff.mustChangePassword) redirect("/");
  return <FirstPasswordForm />;
}
