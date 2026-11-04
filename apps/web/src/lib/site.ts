/**
 * FILE: apps/web/src/lib/site.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Returns the full base address of the website ("https://…"). Needed wherever we must give an
 *   absolute link to someone outside the site, e.g. the return addresses we hand to Stripe's payment page,
 *   or links inside emails.
 * WHERE IT RUNS: on the server (it reads environment variables, the settings given to the app at start-up).
 * FRAMEWORK NOTES: `process.env.NAME` reads an environment variable in Node.js. Vercel, our host, sets
 *   VERCEL_PROJECT_PRODUCTION_URL automatically to the live domain name.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `function name(): string` = a function that takes no input and returns text.
 *   - ternary `cond ? a : b` and template strings `` `https://${host}` `` (text with a value inserted).
 */

/**
 * Absolute base URL: the Vercel production domain when deployed, localhost otherwise.
 * Kind: function.
 * Parameters: none.
 * @returns `string`: e.g. "https://fundhub.lu" when deployed, or "http://localhost:3000" on a developer's PC.
 */
export function siteUrl(): string {
  // The variable is `undefined` (no value) when running locally, because Vercel is not involved there.
  const host = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  // If a host is set, build "https://<host>"; otherwise use the local development address.
  return host ? `https://${host}` : "http://localhost:3000";
}
