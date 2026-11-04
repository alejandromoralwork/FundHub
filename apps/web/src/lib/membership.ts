import "server-only";
/**
 * FILE: apps/web/src/lib/membership.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Sets up the connection to Stripe (the online payment service) used to sell the paid
 *   "Data Intelligence" membership. If Stripe is not configured, it says so by returning `null`, and the
 *   membership page shows a contact form instead of a "Pay" button.
 * WHERE IT RUNS: on the server only. The Stripe secret key must never reach a browser, which is why the file
 *   starts with `import "server-only"` (the build fails if browser code imports this file).
 * FRAMEWORK NOTES: `process.env.NAME` reads environment variables (secret settings given to the server).
 *   `globalThis` is the one object shared by all code in the running server process; we park the Stripe
 *   client there so it is created once and reused, even when Next.js reloads files during development.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - default import `import Stripe from "stripe"` = the library's main export, here a class.
 *   - type assertions `as unknown as { stripe?: Stripe }` = "trust me, treat this value as this shape".
 *   - optional property `stripe?:` = may be missing.
 *   - union return type `Stripe | null` = either a Stripe client or nothing.
 *   - nullish assignment `a ??= b` = "if a is null/undefined, set it to b".
 */

// `import X from "lib"` loads the library's default export. `Stripe` is the official Stripe SDK class:
// `new Stripe(key)` creates a client that can talk to Stripe's servers.
import Stripe from "stripe";

/**
 * Kind: constant.
 * `globalThis` normally has no `stripe` property, so TypeScript would refuse `globalThis.stripe`. The double
 * assertion `as unknown as {...}` tells TypeScript to view it as "an object that may have a `stripe` field".
 * This is a common pattern for keeping a single shared client per server process.
 */
const globalForStripe = globalThis as unknown as { stripe?: Stripe };

/**
 * Stripe price for the Data Intelligence membership (Stripe dashboard → Products).
 * Kind: constant holding an arrow function.
 * Parameters: none.
 * @returns `string | undefined`: the Stripe "price ID" (e.g. "price_123…") from the environment, or
 *          `undefined` when it has not been set. Written as a function so the value is read each time.
 */
export const membershipPrice = () => process.env.STRIPE_PRICE_DATA_MEMBERSHIP;

/**
 * Null until STRIPE_SECRET_KEY and the membership price are set; the page then offers a contact form.
 * Kind: function.
 * Parameters: none.
 * @returns `Stripe | null`: a ready Stripe client, or `null` when payments are not configured.
 */
export function membershipStripe(): Stripe | null {
  // The secret API key from the Stripe dashboard.
  const key = process.env.STRIPE_SECRET_KEY;
  // `!key` = "key is missing/empty". `||` = "or". If either setting is missing, payments are off.
  if (!key || !membershipPrice()) return null;
  // Create the client only the first time (`??=`); later calls reuse the same one.
  globalForStripe.stripe ??= new Stripe(key);
  return globalForStripe.stripe;
}
