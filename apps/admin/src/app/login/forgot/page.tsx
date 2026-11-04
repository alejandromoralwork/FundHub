/**
 * FILE: apps/admin/src/app/login/forgot/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Forgot password" page. It simply shows the form where a staff member enters their email
 *   address to receive a password-reset link.
 * WHERE IT RUNS: the page itself is a server component (rendered on the server); the ForgotForm inside it is
 *   interactive and runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/login/forgot = the URL /admin/login/forgot. It lives outside the
 *   "(console)" group, so the console layout's login check does not apply (you are not logged in yet).
 * TYPESCRIPT YOU WILL SEE HERE: `import type`, a plain (non-async) function component, JSX.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// `@/…` = this app's src folder. The email-entry form.
import { ForgotForm } from "@/components/account-forms";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Forgot password" };

/**
 * Kind: React component — the page. Not async, because it needs no data.
 * Parameters: none.
 * @returns JSX: the forgot-password form.
 */
export default function ForgotPage() {
  return <ForgotForm />;
}
