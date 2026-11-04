/**
 * FILE: apps/web/src/app/account/signup/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "Create an account" page at /account/signup. The left column lists what each of the two
 *   account types gets (fund manager/visitor, or service provider); the right column is the sign-up form.
 *   Already logged-in users are sent to /account. A link like /account/signup?type=provider pre-selects the
 *   provider account type in the form.
 * WHERE IT RUNS: on the server (Node.js) as a React server component; the form itself is interactive in the
 *   browser.
 * FRAMEWORK NOTES: page.tsx inside app/ = a page at the folder's URL. `searchParams` = the URL query string,
 *   given to the page as a Promise. `redirect()` from next/navigation sends the browser elsewhere.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - object and array literals (`{ key: value }`, `[a, b]`) used as constant data.
 *   - `as const`: tells TypeScript the array's values are exactly these strings, not "any string".
 *   - arrow functions `(k) => ...` and the array method `.map()` to turn data into a list of JSX elements.
 *   - `async`/`await`, optional properties (`next?: string`), destructuring and the ternary `c ? a : b`.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next..." and "lucide-react" are npm libraries;
// "@/..." is this app's src folder.
// `Metadata`: type for the page's <head> settings.
import type { Metadata } from "next";
// `redirect(url)`: stop rendering and send the browser to `url`.
import { redirect } from "next/navigation";
// A tick-in-a-circle icon from the Lucide icon library, used as a bullet point.
import { CheckCircle2 } from "lucide-react";
// The shared login/sign-up form component.
import { AuthForm } from "@/components/auth-form";
// Returns the logged-in user from the session cookie, or `null`.
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Kind: constant (Next.js page metadata). Tab title; `robots: { index: false }` keeps it out of search engines.
 */
export const metadata: Metadata = { title: "Create an account", robots: { index: false } };

/**
 * Kind: constant (plain data object).
 * The selling points shown for each account type. Shape: an object with two keys, `visitor` and `provider`,
 * each holding an array of strings (one string per bullet point). Keeping the text as data means the markup
 * below can loop over it instead of repeating the same HTML for every bullet.
 */
const BENEFITS = {
  visitor: [
    "Save providers to your shortlist",
    "Write verified reviews of providers you work with",
    "Get the quarterly market snapshot and sector news",
  ],
  provider: [
    "Claim your company's listing, or propose a new one",
    "FundHub confirms you represent the company (usually within 2 business days)",
    "Keep your services, team, tech stack and clients up to date yourself",
    "Download the private Data Intelligence reports",
  ],
};

/**
 * Kind: async React component (the page).
 * Parameters: props destructured as `{ searchParams }`, typed `Promise<{ next?: string; type?: string }>`:
 *   - `next`: optional page to return to after signing up.
 *   - `type`: optional account type to pre-select ("provider" or anything else = visitor).
 * Returns: Promise of JSX, the page markup.
 */
export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string; type?: string }> }) {
  // Wait for the query string and copy out both optional values.
  const { next, type } = await searchParams;
  // Logged-in users don't need a new account; send them to their account page.
  if (await getCurrentUser()) redirect("/account");

  // Layout: Tailwind `grid` with `md:grid-cols-2` = one column on phones, two side-by-side columns on
  // medium screens and wider; `gap-6` = space between them.
  return (
    <main className="mx-auto grid w-full max-w-4xl flex-1 gap-6 p-4 sm:p-6 md:grid-cols-2">
      <div>
        <h1 className="text-xl font-semibold text-ink">Create a free FundHub account</h1>
        <p className="mt-1 text-sm text-ink-600">Two kinds of account, one login.</p>
        {/* Loop over the two account types. `["visitor", "provider"] as const` makes TypeScript treat `k` as
            exactly "visitor" | "provider" (a union type), so `BENEFITS[k]` below is known to be valid.
            `.map((k) => ...)` runs the arrow function once per item and returns a new array, here an array of
            JSX blocks, which React shows one after another. */}
        {(["visitor", "provider"] as const).map((k) => (
          // `key` is required by React on each item of a list so it can tell items apart when re-drawing.
          <div key={k} className="mt-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              {k === "visitor" ? "Fund managers & visitors" : "Service providers"}
            </p>
            <ul className="mt-2 space-y-1.5">
              {/* Inner loop: one <li> bullet per benefit string `b`; the text itself doubles as the key. */}
              {BENEFITS[k].map((b) => (
                <li key={b} className="flex gap-2 text-sm text-ink-600">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald" /> {b}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {/* Business rule shown to users: providers edit facts, but FundHub alone controls fees, scores,
            reviews and the Verified badge, which keeps the index independent. */}
        <p className="mt-5 rounded-md bg-canvas p-3 text-xs leading-relaxed text-ink-600">
          Providers control their factual data. Fee ranges, peer scores, reviews and the Verified badge stay under
          FundHub&apos;s independent control.
        </p>
      </div>
      {/* The form. `defaultType` pre-selects "provider" only when the URL says ?type=provider; any other value
          (or none) falls back to "visitor", so a strange value in the URL cannot break the form. */}
      <AuthForm mode="signup" next={next} defaultType={type === "provider" ? "provider" : "visitor"} />
    </main>
  );
}
