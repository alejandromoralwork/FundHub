/**
 * FILE: apps/admin/src/app/login/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Console's login page (email + password). If the visitor is already fully logged in it
 *   sends them straight to the dashboard. After a successful password reset, the URL has ?reset=1 and the
 *   form shows a "password changed" message.
 * WHERE IT RUNS: on the server (Node.js) as a server component; the LoginForm runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/login = /admin/login. It is outside the "(console)" group, so it is not
 *   wrapped by the console layout (which would require being logged in). `searchParams` = values after "?".
 * TYPESCRIPT YOU WILL SEE HERE: optional chaining `s?.mfaPassed`, optional properties `reset?: string`,
 *   `===`, `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// `redirect(url)` sends the browser elsewhere (basePath /admin is added automatically).
import { redirect } from "next/navigation";
// `@/…` = this app's src folder. The email/password form.
import { LoginForm } from "@/components/login-forms";
// Reads the current login session from the cookie.
import { getSession } from "@/lib/auth";

/** Kind: constant (Next.js setting). Always render fresh, because it depends on the session cookie. */
export const dynamic = "force-dynamic";
/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Login" };

/**
 * Kind: React component (async server component) — the page.
 * @param props  `{ searchParams }` destructured; a Promise of `{ reset?: string }`.
 * @returns `Promise<JSX>`: the login form.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const s = await getSession();
  // `s?.mfaPassed` = "s.mfaPassed if there is a session, else undefined". Fully logged in: go to dashboard.
  if (s?.mfaPassed) redirect("/");
  // `resetDone` is true only when the URL contains exactly ?reset=1.
  return <LoginForm resetDone={(await searchParams).reset === "1"} />;
}
