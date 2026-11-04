/**
 * FILE: apps/admin/src/app/login/reset/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Choose a new password" page, opened from the link in a password-reset email. The link
 *   carries a secret token in the URL (?token=…); the page passes it to the form, which sends it back with
 *   the new password. Without a token, the visitor is sent to the "Forgot password" page instead.
 * WHERE IT RUNS: on the server (Node.js) as a server component; the ResetForm runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/login/reset = /admin/login/reset. `searchParams` holds the URL's "?" values.
 *   `redirect(...)` stops rendering and sends the browser elsewhere (basePath /admin is added automatically).
 * TYPESCRIPT YOU WILL SEE HERE: object destructuring, optional properties, `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Next.js redirect helper.
import { redirect } from "next/navigation";
// `@/…` = this app's src folder. The new-password form.
import { ResetForm } from "@/components/account-forms";

/** Kind: constant (Next.js setting). Render on every request, since the content depends on the URL token. */
export const dynamic = "force-dynamic";
/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Choose a new password" };

/**
 * Kind: React component (async server component) — the page.
 * @param props  `{ searchParams }` destructured; a Promise of `{ token?: string }`.
 * @returns `Promise<JSX>`: the reset form.
 */
export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  // Take `token` out of the URL values (undefined if absent).
  const { token } = await searchParams;
  // No token: nothing to reset with, go to the "Forgot password" page. (TypeScript knows that after this
  // line `token` is a string, because `redirect` never returns.)
  if (!token) redirect("/login/forgot");
  // The token is checked only when the form is submitted, on the server.
  return <ResetForm token={token} />;
}
