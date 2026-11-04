import "server-only";
/**
 * FILE: apps/web/src/lib/client-ip.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Works out the internet (IP) address of the visitor who sent the current request. Forms use it
 *   for rate limiting: "no more than N attempts per hour from the same address", to slow down robots.
 * WHERE IT RUNS: on the server only. It reads the incoming request's headers, which only exist on the server.
 * FRAMEWORK NOTES: `import "server-only"` (the first line) is a guard: if any browser-side code ever imports
 *   this file, the build fails. `headers()` from Next.js gives the HTTP headers of the request being answered.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async function … : Promise<string>` = a function that finishes later and then hands back text.
 *   - `await` = wait for a Promise's result before carrying on.
 *   - optional chaining `a?.b` = "read b only if a exists, otherwise give undefined instead of crashing".
 *   - logical OR `a || b` = "use a if it is a non-empty value, otherwise b".
 */

// `import { x } from "y"` loads the named thing x from the module y. A plain name like "next/headers"
// is a library installed from npm (here: part of Next.js itself).
// `headers` = Next.js function that returns the request's HTTP headers (extra lines of info sent by the browser).
import { headers } from "next/headers";

/**
 * Best-effort client IP for rate limiting (Vercel sets x-forwarded-for).
 * Kind: async function.
 * Parameters: none.
 * @returns `Promise<string>`: the visitor's IP address, or the text "unknown" if none can be found.
 * Why "best effort": our host (Vercel) sits in front of the app and passes the real address along in the
 * `x-forwarded-for` header. That header can hold a list "client, proxy1, proxy2", so we take the first entry.
 */
export async function clientIp(): Promise<string> {
  // In recent Next.js versions `headers()` is async, so we `await` it. `const` = a name that is never reassigned.
  const h = await headers();
  // Step by step: get the header (may be null) → `?.split(",")` cut the list at commas → `[0]` first item →
  // `?.trim()` remove spaces. If that gives nothing, try the `x-real-ip` header, and finally "unknown".
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "unknown";
}
