/**
 * FILE: apps/web/src/app/privacy-request/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The /privacy-request page, where anyone can exercise their GDPR rights (the EU data
 *   protection law): ask for a copy of their data, a correction, a deletion, or object to its use.
 *   It shows a short explanation and the request form.
 * WHERE IT RUNS: this page is a server component (built on the server); the form inside it (GdprForm) is a
 *   client component that runs in the browser, because it reacts to typing and button clicks.
 * FRAMEWORK NOTES: In the Next.js App Router a file called page.tsx inside app/ is a web page and its folder
 *   path is the URL (app/privacy-request/page.tsx -> /privacy-request). Exporting `metadata` sets the
 *   page's <title> and description.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type`: import only a type.
 *   - type annotation `metadata: Metadata`: the object must match Next.js's Metadata shape.
 */

// `import { a } from "b"` loads the named export `a` from module "b"; "next" is an npm library,
// "@fundhub/..." is our shared package, "@/..." this app's src folder.
// Metadata: the Next.js type for the `metadata` export.
import type { Metadata } from "next";
// Link: Next.js in-site link (like <a>, without a full page reload).
import Link from "next/link";
// COMPANY: shared constants about FundHub as a company (legal name, addresses, contact emails...).
import { COMPANY } from "@fundhub/core/company";
// GdprForm: the interactive data-request form.
import { GdprForm } from "@/components/gdpr-form";

/** Kind: constant (Next.js metadata). Tab title "Data request · FundHub" plus a search-engine description. */
export const metadata: Metadata = { title: "Data request", description: "Access, correct or delete your personal data held by FundHub." };

/**
 * Kind: React component (server component) — the page. Takes no parameters.
 * @returns JSX: heading, explanation paragraph and the form.
 */
export default function PrivacyRequestPage() {
  // Tailwind: `max-w-2xl` keeps the column narrow for easy reading; `space-y-4` spaces the children.
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 space-y-4 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Your data, your rights</h1>
      {/* In the paragraph, `{" "}` forces a space next to the link (JSX drops spaces at line ends), and
          `{COMPANY.privacyEmail}` inserts the value of that constant: the privacy email address. */}
      <p className="text-sm leading-relaxed text-ink-600">
        Ask for a copy of the personal data FundHub holds about you, have it corrected or deleted, or object to how we use it.
        We confirm the request by email and answer within one month. See our{" "}
        <Link href="/legal/privacy" className="font-medium text-emerald-700 hover:underline">
          privacy policy
        </Link>{" "}
        or write to {COMPANY.privacyEmail}.
      </p>
      <GdprForm />
    </main>
  );
}
