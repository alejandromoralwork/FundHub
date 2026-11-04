/**
 * FILE: apps/admin/src/app/(console)/account/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Account security" page, where a logged-in staff member can change their password and
 *   move their two-factor (2FA) code to a new phone app. It prepares a brand-new 2FA secret and a QR code
 *   picture of it, then hands both to the interactive form component that does the rest.
 * WHERE IT RUNS: on the server (Node.js). It is a "server component": it runs before the page is sent, so it
 *   can read the login session and create secrets without exposing any of that logic to the browser.
 * FRAMEWORK NOTES: Next.js treats any file called page.tsx inside the app/ folder as a web page; the folder
 *   path becomes the URL. A folder in round brackets, like "(console)", is a "route group": it groups pages
 *   so they share a layout but does NOT appear in the URL. The Console runs under basePath /admin, so this
 *   page lives at /admin/account.
 * TYPESCRIPT YOU WILL SEE HERE: `import type` (import only a type, no code), `export const` / `export default`,
 *   `async`/`await`, object literals `{ a: 1 }`, JSX (HTML-like markup inside TypeScript).
 */

// `import { a } from "b"` pulls the named thing `a` out of module "b" so this file can use it.
// `import type { Metadata }` imports only a TypeScript type (it vanishes when compiled; no code is loaded).
// "next" = the Next.js library from npm; `Metadata` describes page info such as the browser tab title.
import type { Metadata } from "next";
// `import QRCode from "qrcode"` is a "default import": the module's main export, named QRCode here.
// The "qrcode" npm library turns text into a QR-code picture.
import QRCode from "qrcode";
// `@/…` means "this app's src folder". AccountSecurity is the interactive (browser-side) form component.
import { AccountSecurity } from "@/components/account-forms";
// Our own login helpers: make a 2FA secret, check the visitor is logged-in staff, build the 2FA app link.
import { newTotpSecret, requireStaff, totpUri } from "@/lib/auth";

/**
 * Kind: constant (a special Next.js setting).
 * `dynamic = "force-dynamic"` tells Next.js never to pre-build or cache this page: it must be rendered
 * fresh on every visit, because it creates a new secret each time and depends on who is logged in.
 */
export const dynamic = "force-dynamic";
/**
 * Kind: constant of type `Metadata`.
 * Next.js reads an exported `metadata` object from a page and uses it for the <title> in the browser tab.
 * `: Metadata` is a type annotation: TypeScript checks the object has the right shape.
 */
export const metadata: Metadata = { title: "Account security" };

/**
 * Kind: React component (async server component) — the page itself.
 * `export default` marks it as the file's main export, which is what Next.js renders for this URL.
 * Parameters: none.
 * @returns `Promise<JSX>`: the markup to show, arriving later because the function is `async`.
 */
export default async function AccountPage() {
  // `requireStaff()` checks the login cookie. If the visitor is not fully logged in (password + 2FA) it
  // redirects them to the login page and this function stops. Otherwise it returns the staff member.
  // `await` pauses until that check (which reads the database) finishes. `const` = a name that is never reassigned.
  const staff = await requireStaff();
  // A fresh secret each visit; it's only saved once a code from the new app proves it works.
  const secret = newTotpSecret();
  // `totpUri(...)` builds the "otpauth://…" link that 2FA apps understand; `QRCode.toDataURL` draws it as a
  // PNG picture encoded as text ("data URL") so it can be put straight into an <img> tag.
  // `{ margin: 1, width: 320 }` is an options object: a thin white border and a 320-pixel-wide image.
  const qrDataUrl = await QRCode.toDataURL(totpUri(secret, staff.email), { margin: 1, width: 320 });
  // JSX: `<AccountSecurity … />` renders the form component. Each `name={value}` is a "prop" (an input to the
  // component). `{ secret, qrDataUrl }` is shorthand for `{ secret: secret, qrDataUrl: qrDataUrl }`.
  return <AccountSecurity email={staff.email} enrol={{ secret, qrDataUrl }} />;
}
