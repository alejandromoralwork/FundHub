"use client";

/**
 * FILE: apps/web/src/components/cookie-consent.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The cookie banner required by EU privacy rules (GDPR / ePrivacy). Until the visitor
 *   chooses "Essential only" or "Accept analytics", a box at the bottom of the screen asks them. The choice
 *   is saved in a cookie called `fh_consent` for one year. A "Cookie settings" link in the footer can
 *   reopen the banner. Other code (the analytics loader) calls `readConsent()` and listens for an event so
 *   analytics only ever load after consent.
 * WHERE IT RUNS: in the browser (`"use client"`): it reads and writes `document.cookie` and listens to
 *   browser events, which do not exist on the server.
 * FRAMEWORK NOTES: Next.js still pre-renders client components on the server once to produce the first
 *   HTML. That is why the banner starts closed and only decides to open inside `useEffect`, which runs in
 *   the browser after the page has loaded (the server and browser first render must match).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - union of literal strings (`"analytics" | "essential"`), `Consent | null` return type.
 *   - `typeof x === "undefined"` (checks whether a global exists), regular expressions `/.../`.
 *   - optional chaining `m?.[1]`, type assertion `as Consent`, nullish coalescing `??`.
 *   - template strings, arrow functions, `useState` / `useEffect` hooks, custom browser events.
 */

// `import { a } from "b"` pulls named things from a module; these are npm libraries.

// Next.js link component (page change without full reload).
import Link from "next/link";
// React hooks: useState remembers a value; useEffect runs code after the screen updates.
import { useEffect, useState } from "react";

/** Kind: constant. The cookie's name. */
const COOKIE = "fh_consent";
/**
 * Kind: exported type alias. The two possible choices: "analytics" (analytics allowed) or "essential"
 * (only cookies needed to run the site, e.g. the login session).
 */
export type Consent = "analytics" | "essential";

/**
 * Kind: exported function.
 * @returns `Consent | null`: the saved choice, or `null` when no choice has been made yet (or when this is
 *          called on the server, where there are no cookies to read).
 */
export function readConsent(): Consent | null {
  // `document` only exists in a browser; on the server `typeof document` is "undefined".
  if (typeof document === "undefined") return null;
  // `document.cookie` is one string like "a=1; fh_consent=analytics; b=2". The regular expression looks for
  // `fh_consent=` at the start or after "; ", followed by exactly "analytics" or "essential"; the brackets
  // `( )` capture that word. `.match` returns an array (item [1] = the captured word) or null if not found.
  const m = document.cookie.match(/(?:^|; )fh_consent=(analytics|essential)/);
  // `m?.[1]` = item 1 if `m` is not null; `as Consent` tells TypeScript it is one of our two words;
  // `?? null` turns "nothing found" (undefined) into null.
  return (m?.[1] as Consent) ?? null;
}

/**
 * Kind: function (private to this file).
 * @param c  type `Consent`: the visitor's choice.
 * @returns  `void` (nothing). Saves the cookie and announces the choice to the rest of the page.
 */
function writeConsent(c: Consent) {
  // Writing to `document.cookie` adds or updates one cookie. The template string builds e.g.
  // "fh_consent=analytics; Max-Age=31536000; Path=/; SameSite=Lax; Secure":
  //   Max-Age = lifetime in seconds (60*60*24*365 = one year), Path=/ = valid on every page,
  //   SameSite=Lax = not sent along with most requests from other sites, Secure = only over HTTPS
  //   (added only when the site is on https, so local development over http still works).
  document.cookie = `${COOKIE}=${c}; Max-Age=${60 * 60 * 24 * 365}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  // Analytics scripts listen for this and load only after consent.
  // A CustomEvent is a home-made browser event named "fh:consent"; `detail` carries the choice.
  window.dispatchEvent(new CustomEvent("fh:consent", { detail: c }));
}

/** Banner shown until a choice is made; "Cookie settings" in the footer reopens it. */
/**
 * Kind: React component (exported; placed once in the site layout). Props: none.
 * Returns: the banner JSX, or `null` (nothing) when it should be hidden.
 */
export function CookieConsent() {
  // Is the banner showing? Starts `false` so the server-made HTML and the browser's first draw agree.
  const [open, setOpen] = useState(false);
  // `useEffect(fn, [])`: the empty list means "run once, after the component first appears in the browser".
  useEffect(() => {
    // Show the banner only if no choice has been saved yet.
    setOpen(readConsent() === null);
    // When the footer link fires the "fh:cookie-settings" event, open the banner again.
    const reopen = () => setOpen(true);
    window.addEventListener("fh:cookie-settings", reopen);
    // Clean-up function: React runs it when the component is removed, so the listener does not linger.
    return () => window.removeEventListener("fh:cookie-settings", reopen);
  }, []);
  // Hidden: draw nothing. (Hooks above must always run first; React requires the same hooks on every draw.)
  if (!open) return null;

  // Kind: arrow function. Saves the choice and closes the banner.
  const choose = (c: Consent) => {
    writeConsent(c);
    setOpen(false);
  };
  return (
    // Fixed to the bottom of the screen with a small margin on each side (`inset-x-3 bottom-3`),
    // centred and at most `max-w-2xl` wide, above other content (`z-50`).
    <div role="dialog" aria-label="Cookie choices" className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-2xl rounded-lg border border-slate-200 bg-white p-4 shadow-xl sm:inset-x-6">
      <p className="text-sm text-ink-600">
        We use cookies needed to run FundHub (like keeping you logged in). With your consent we also use analytics cookies to
        understand how the site is used. <Link href="/legal/cookies" className="font-medium text-emerald-700 underline">Cookie policy</Link>
      </p>
      {/* The two choices, right-aligned (`justify-end`). Both buttons are equally easy to press, as privacy
          rules expect: refusing must be as easy as accepting. `onClick={() => choose("...")}` wraps the call
          in an arrow function so it runs on click, not while drawing. */}
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={() => choose("essential")} className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-slate-50">
          Essential only
        </button>
        <button type="button" onClick={() => choose("analytics")} className="rounded-md bg-ink-900 px-3 py-2 text-xs font-semibold text-white hover:bg-ink-800">
          Accept analytics
        </button>
      </div>
    </div>
  );
}

/**
 * Kind: React component (exported; used in the site footer). Props: none.
 * Returns: a small "Cookie settings" button. Clicking it fires the "fh:cookie-settings" browser event,
 * which the CookieConsent banner above listens for to reopen itself. Using an event means the footer and
 * the banner need no shared state between them.
 */
export function CookieSettingsLink() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event("fh:cookie-settings"))} className="text-xs text-ink-600 hover:text-ink hover:underline">
      Cookie settings
    </button>
  );
}
