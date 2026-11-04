"use client";

/**
 * FILE: apps/web/src/app/error.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The friendly "Something went wrong" screen shown when any page of the website crashes while
 *   loading (for example because the database is down). It logs the error, shows a reference code, and offers
 *   a "Try again" button that re-attempts loading the page.
 * WHERE IT RUNS: in the browser. The `"use client"` line at the very top (it must be the first statement)
 *   marks this as a "client component", meaning React also runs it in the visitor's browser, which is needed
 *   for the clickable button and for `useEffect`. Next.js requires error screens to be client components.
 * FRAMEWORK NOTES: A file called error.tsx in an app/ folder is Next.js's "error boundary" for that folder and
 *   everything below it. Placed directly in app/, it covers the whole site. When a page throws an error,
 *   Next.js shows this component instead, passing it the `error` and a `reset` function.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - an intersection type `Error & { digest?: string }`: "an Error that also may have a `digest` text".
 *   - a function type `() => void`: "a function that takes nothing and returns nothing".
 *   - the React hook `useEffect` and the `&&` trick for showing markup conditionally.
 */

// `import { a } from "b"` = use `a` from module `b`; "react" is the React library from npm.
// `useEffect`: a React "hook" that runs some code after the component has appeared on screen.
import { useEffect } from "react";

/**
 * Kind: React component (client component; Next.js error screen).
 * Parameters: one props object, destructured as `{ error, reset }`:
 *   - `error`: type `Error & { digest?: string }`, the error that happened. `digest` is an optional short code
 *     Next.js adds so the error can be matched with the full details in the server logs (the real message is
 *     hidden from visitors for security).
 *   - `reset`: type `() => void`, a function from Next.js that tries to draw the page again.
 * Returns: JSX, the error screen.
 */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  // After the screen appears, write the error to the browser's developer console. The `[error]` list means
  // "run again only if `error` changes", so it is not logged repeatedly.
  useEffect(() => console.error(error), [error]);

  // `flex flex-col items-center justify-center` (Tailwind) centres the content both ways on the page.
  return (
    <main className="flex flex-1 flex-col items-center justify-center p-10 text-center">
      <h1 className="text-xl font-semibold text-ink">Something went wrong</h1>
      <p className="mt-1 max-w-md text-sm text-ink-600">
        We couldn&apos;t load this page. If this keeps happening, the database may be unreachable.
      </p>
      {/* `error.digest && (...)`: show the reference line only when a digest exists. */}
      {error.digest && <p className="mt-2 font-mono text-xs text-slate-400">Ref: {error.digest}</p>}
      {/* `onClick={reset}`: clicking the button calls Next.js's `reset` to retry loading the page.
          `type="button"` makes it a plain button (not a form submit button). */}
      <button
        type="button"
        onClick={reset}
        className="mt-5 rounded-md bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
      >
        Try again
      </button>
    </main>
  );
}
