/**
 * FILE: apps/admin/src/lib/site.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Gives the public website's base address (e.g. "https://fundhub.lu"), so emails sent from the
 *   Console can link to pages on the website.
 * WHERE IT RUNS: on the server (Node.js), where the environment variables it reads are available.
 * FRAMEWORK NOTES: `process.env.X` reads an environment variable: a setting given to the server from outside
 *   the code. `NODE_ENV` is set to "production" by Next.js in the live build and "development" locally.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - a function with a declared return type `(): string`.
 *   - regular expressions `/\/$/` and the ternary `condition ? a : b`.
 */

/**
 * Kind: function.
 * Public website origin, used in links inside emails.
 * @returns `string` — the website address without a trailing slash, so callers can add "/providers/…" safely.
 */
export function websiteUrl(): string {
  // If configured, use PUBLIC_SITE_URL, removing one trailing "/" (`/\/$/` = a slash at the very end).
  if (process.env.PUBLIC_SITE_URL) return process.env.PUBLIC_SITE_URL.replace(/\/$/, "");
  // Otherwise: the live domain in production, or the local website development server.
  return process.env.NODE_ENV === "production" ? "https://fundhub.lu" : "http://localhost:3000";
}
