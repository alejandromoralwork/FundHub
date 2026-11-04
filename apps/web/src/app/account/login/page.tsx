/**
 * FILE: apps/web/src/app/account/login/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The login page at /account/login. If the visitor is already logged in it sends them straight
 *   on (to the page they were trying to reach, or to /account). Otherwise it shows the login form.
 * WHERE IT RUNS: on the server (Node.js). It is a React server component, so it can check the login cookie and
 *   redirect before any HTML is sent to the browser.
 * FRAMEWORK NOTES: page.tsx inside app/ = a web page; the folder path (account/login) is the URL. Next.js
 *   passes every page a `searchParams` prop holding the URL's query string (the part after "?"), e.g.
 *   /account/login?next=/compare gives { next: "/compare" }. In current Next.js it arrives as a Promise and
 *   must be awaited. `redirect()` stops the page and sends the browser to another URL instead.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async function` / `await`: the function can pause while waiting for slow work (cookies, database).
 *   - `Promise<T>`: "a value of type T that arrives later".
 *   - inline object types `{ next?: string }`: `?` means the property is optional (may be missing).
 *   - destructuring `const { next } = obj`: copy the `next` property out of an object into a variable.
 *   - optional chaining `a?.b()` and the ternary `cond ? x : y`.
 */

// Imports: `import { a } from "b"` pulls named things out of another module. "next/..." = the Next.js
// framework (installed from npm); "@/..." = this app's own src folder.
// `Metadata`: Next.js's type for the page <head> settings (type-only import, vanishes at compile time).
import type { Metadata } from "next";
// `redirect(url)`: Next.js helper that aborts rendering and sends the browser to `url`.
import { redirect } from "next/navigation";
// The login/sign-up form component (email, password, submit button).
import { AuthForm } from "@/components/auth-form";
// Reads the session cookie and returns the logged-in user, or `null` if nobody is logged in.
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Kind: constant (Next.js page metadata).
 * Sets the browser-tab title and asks search engines not to index the login page (`robots: { index: false }`).
 */
export const metadata: Metadata = { title: "Log in", robots: { index: false } };

/**
 * Kind: async React component (the page). Being `async` is allowed for server components.
 * Parameters: one props object, destructured as `{ searchParams }`. Its type, written after the colon, is
 *   `{ searchParams: Promise<{ next?: string }> }`: the query string arrives later (a Promise) and may contain
 *   an optional `next`, the page to return to after logging in.
 * Returns: `Promise` of JSX (because the function is async), the login page markup.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // Wait for the query string, then pull out `next` (a string, or `undefined` if the URL had no ?next=).
  const { next } = await searchParams;
  // If someone is already logged in there is nothing to do here, so move them on.
  // `next?.startsWith("/")`: `?.` means "only call startsWith if next exists"; otherwise the result is
  // undefined (treated as false). Only accepting paths that start with "/" is a safety rule: it stops a
  // crafted link like ?next=https://evil.example from bouncing users to another website ("open redirect").
  // `cond ? a : b` (ternary) picks `next` when it is safe, otherwise the default "/account".
  if (await getCurrentUser()) redirect(next?.startsWith("/") ? next : "/account");

  // The markup. Tailwind utility classes style it (mx-auto = centre, max-w-md = medium width, p-4 = padding).
  return (
    <main className="mx-auto w-full max-w-md flex-1 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Log in to FundHub</h1>
      {/* <p className="mt-1 mb-5 text-sm text-ink-600">
        One login for fund managers and service providers..
      </p> */}
      {/* The block above is old markup switched off by putting it inside a JSX comment, kept for later. */}
      {/* `mode="login"` tells the shared form to behave as a login form; `next={next}` passes the return page
          on, so after a successful login the form can send the user back where they came from. */}
      <AuthForm mode="login" next={next} />
    </main>
  );
}
