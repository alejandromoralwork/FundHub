/**
 * FILE: apps/web/src/app/account/forgot/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "Forgot your password?" page at the URL /account/forgot. It shows a heading, a short
 *   explanation, the form where the visitor types their email (we then email them a reset link), and a link
 *   back to the login page.
 * WHERE IT RUNS: on the server (Node.js). It is a React "server component": Next.js runs it on the server and
 *   sends finished HTML to the browser. The form inside it (ForgotPasswordForm) is a separate component that
 *   does its own interactive work in the browser.
 * FRAMEWORK NOTES: Next.js "App Router" turns every file called page.tsx inside src/app/ into a web page; the
 *   folder path becomes the URL, so app/account/forgot/page.tsx is served at /account/forgot. The file must
 *   "export default" a React component, which Next.js calls to draw the page. An exported constant called
 *   `metadata` sets the page's <title> and other <head> tags.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type { X }`: imports only a type (a description of data shape), which disappears when compiled.
 *   - `const name: Type = value`: a constant with a type annotation, so TypeScript checks the value's shape.
 *   - JSX: HTML-like markup written inside TypeScript (.tsx files), turned into real HTML by React.
 */

// `import { a } from "b"` pulls named things (`a`) out of another file or library (`b`) so this file can use
// them. Plain names like "next" are libraries installed from npm; "@/..." means this app's own src folder.
// `Metadata` is Next.js's type describing what may go in a page's <head> (title, description, robots...).
import type { Metadata } from "next";
// `Link` is Next.js's version of an <a> link: it moves between pages without a full browser reload.
// It is a "default import" (no curly braces) because the library exports it as its main thing.
import Link from "next/link";
// The interactive form (email box + button) that asks the server to send a password-reset email.
import { ForgotPasswordForm } from "@/components/auth-form";

/**
 * Kind: constant (Next.js page metadata).
 * Next.js reads this exported object and writes it into the page's <head>.
 * - `title`: the text in the browser tab.
 * - `robots: { index: false }`: tells search engines like Google not to list this page; there is no reason
 *   for a password-reset screen to appear in search results.
 */
export const metadata: Metadata = { title: "Forgot password", robots: { index: false } };

/**
 * Kind: React component (the page itself).
 * A React component is a function that returns JSX (the markup to show). `export default` makes it the
 * file's main export, which is how Next.js finds the page.
 * Parameters: none.
 * Returns: JSX for the whole page.
 */
export default function ForgotPasswordPage() {
  // Everything inside `return ( ... )` is JSX. `className` is JSX's name for the HTML `class` attribute.
  // The class names are Tailwind CSS "utility classes": each one is a tiny style rule, for example
  // `mx-auto` = centre horizontally, `max-w-md` = limit width to a medium size, `p-4` = padding,
  // `sm:p-6` = bigger padding on small screens and up, `flex-1` = grow to fill the available height.
  // Colours like `text-ink` and `text-ink-600` are FundHub's own brand colours defined in the Tailwind config.
  return (
    <main className="mx-auto w-full max-w-md flex-1 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Forgot your password?</h1>
      {/* `&apos;` is the HTML code for an apostrophe; JSX rules ask for it instead of a bare ' in text. */}
      <p className="mt-1 mb-5 text-sm text-ink-600">Enter your email and we&apos;ll send you a link to choose a new one.</p>
      {/* A component is used like an HTML tag. `<X />` with a slash means "no children inside". */}
      <ForgotPasswordForm />
      <p className="mt-4 text-center text-xs">
        {/* `href` is the destination URL. `hover:underline` underlines the link when the mouse is over it. */}
        <Link href="/account/login" className="text-emerald-700 hover:underline">
          Back to login
        </Link>
      </p>
    </main>
  );
}
