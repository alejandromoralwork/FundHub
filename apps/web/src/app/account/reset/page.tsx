/**
 * FILE: apps/web/src/app/account/reset/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "Choose a new password" page at /account/reset. Users land here from the link in the
 *   password-reset email, which carries a secret one-time `token` in the URL (?token=...). If the token is
 *   present the page shows the new-password form; if it is missing it explains the link is broken and offers
 *   to send a new one.
 * WHERE IT RUNS: on the server (Node.js) as a React server component; the form inside runs in the browser.
 * FRAMEWORK NOTES: page.tsx inside app/ = a page; the folder path is the URL. `searchParams` is the query
 *   string (after "?") that Next.js hands to every page, delivered as a Promise you must await.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async` / `await` and `Promise<T>` (a value that arrives later).
 *   - optional property `token?: string` (may be missing) and destructuring `const { token } = ...`.
 *   - the ternary `cond ? a : b` used inside JSX to choose between two blocks of markup.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`; "next..." = framework, "@/..." = this app).
// `Metadata`: type for the page's <head> settings (a type-only import).
import type { Metadata } from "next";
// `Link`: Next.js link that changes page without a full reload.
import Link from "next/link";
// The form with "new password" fields; it sends the token and new password to the server.
import { ResetPasswordForm } from "@/components/auth-form";

/**
 * Kind: constant (Next.js page metadata). Tab title, and `robots: { index: false }` keeps it out of Google.
 */
export const metadata: Metadata = { title: "Choose a new password", robots: { index: false } };

/**
 * Kind: async React component (the page).
 * Parameters: props object destructured as `{ searchParams }`, typed `Promise<{ token?: string }>`: the query
 *   string, which may contain the reset `token` from the email link.
 * Returns: Promise of JSX, the page markup.
 */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  // Wait for the query string and take out `token` (a string, or `undefined` when absent).
  const { token } = await searchParams;
  return (
    <main className="mx-auto w-full max-w-md flex-1 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Choose a new password</h1>
      {/* `{ ... }` in JSX runs a TypeScript expression. `token ? (A) : (B)` shows block A when a token exists
          (any non-empty string counts as "true") and block B otherwise. The token itself is only checked
          on the server when the form is submitted. */}
      {token ? (
        <div className="mt-5">
          {/* Passing the token to the form as a "prop" (an input to a component), like an HTML attribute. */}
          <ResetPasswordForm token={token} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-600">
          {/* `{" "}` inserts a plain space; JSX would otherwise drop the space before the link. */}
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
