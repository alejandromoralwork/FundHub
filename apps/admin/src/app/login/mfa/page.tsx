/**
 * FILE: apps/admin/src/app/login/mfa/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The second login step, "Two-factor authentication". After the password is accepted, the
 *   staff member must type the 6-digit code from their authenticator app. On their very first login they
 *   have no app set up yet, so this page creates a new secret and shows it as a QR code to scan.
 * WHERE IT RUNS: on the server (Node.js) as a server component (it reads the session and creates secrets);
 *   the MfaForm it renders runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/login/mfa = /admin/login/mfa. `redirect("/login")` sends the visitor
 *   elsewhere; with the Console's basePath it becomes /admin/login automatically.
 * TYPESCRIPT YOU WILL SEE HERE: `async`/`await`, early `return`, object shorthand `{ secret, qrDataUrl }`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// `redirect(url)` (Next.js) stops rendering and sends the browser to another address.
import { redirect } from "next/navigation";
// Default import of the "qrcode" npm library, which draws QR codes.
import QRCode from "qrcode";
// `@/…` = this app's src folder. The code-entry (and optional enrolment) form.
import { MfaForm } from "@/components/login-forms";
// getSession = the current login session (or null); newTotpSecret / totpUri = create a 2FA secret and its app link.
import { getSession, newTotpSecret, totpUri } from "@/lib/auth";

/** Kind: constant (Next.js setting). Render fresh on every request: depends on the session, makes new secrets. */
export const dynamic = "force-dynamic";
/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Two-factor authentication" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the 2FA form, either plain or with enrolment details.
 */
export default async function MfaPage() {
  // The half-finished login (password checked, code not yet).
  const s = await getSession();
  // No session at all: back to the password step.
  if (!s) redirect("/login");
  // Already fully logged in: go to the dashboard.
  if (s.mfaPassed) redirect("/");
  // 2FA already set up: just ask for the code. `return` ends the function here.
  if (s.staff.totpEnabled) return <MfaForm />;

  // First login: enrol. The secret is only saved once a valid code proves the app is set up.
  const secret = newTotpSecret();
  // Draw the app link as a 360-pixel QR code, encoded as a "data URL" (an image held in text).
  const qrDataUrl = await QRCode.toDataURL(totpUri(secret, s.staff.email), { margin: 1, width: 360 });
  // `enrol={{ secret, qrDataUrl }}`: outer braces = "a JavaScript value here", inner = an object.
  return <MfaForm enrol={{ secret, qrDataUrl }} />;
}
