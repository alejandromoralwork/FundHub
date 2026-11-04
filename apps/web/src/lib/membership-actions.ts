"use server";
/**
 * FILE: apps/web/src/lib/membership-actions.ts
 * PART: website (apps/web)
 * WHAT IT DOES: The server action behind the "Become a member" button for the paid Data Intelligence
 *   membership. It checks the visitor is logged in and not already a member, asks Stripe to open a secure
 *   checkout page for a monthly/yearly subscription, and sends the visitor there to pay.
 * WHERE IT RUNS: on the server. It uses the Stripe secret key, which must never reach the browser.
 * FRAMEWORK NOTES:
 *   - `"use server"` (first line) makes every exported function here a server action: a form or button in the
 *     browser can call it, and Next.js runs it on the server. It must stay the very first statement.
 *   - `redirect(url)` sends the visitor to another page (here also to Stripe's own website) and stops the function.
 *   - Stripe Checkout is a payment page hosted by Stripe. We create a "checkout session" describing what is
 *     being bought; Stripe returns a URL for it; after paying, Stripe sends the visitor back to `success_url`.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async`/`await`; template strings `` `${base}/…` ``; object shorthand `{ metadata }` = `{ metadata: metadata }`.
 *   - non-null assertion `x!` = "I know this is not empty" (TypeScript then stops warning).
 */

// `import { a } from "b"` loads named things from module b. "next/navigation" is part of Next.js.
import { redirect } from "next/navigation";
// Relative paths ("./x") are other files in this folder. Who is logged in, and are they already a member?
import { getCurrentUser, hasDataMembership } from "./auth/session";
// The Stripe price id and the Stripe client (null when payments are not configured).
import { membershipPrice, membershipStripe } from "./membership";
// The site's full base URL, for the addresses Stripe sends people back to.
import { siteUrl } from "./site";

/**
 * Sends a logged-in user to Stripe Checkout for the Data Intelligence membership.
 * Kind: server action (async function). Parameters: none (uses the logged-in user).
 * @returns `Promise<void>` in type terms, but in practice it always ends with a redirect.
 */
export async function startMembershipCheckout() {
  const user = await getCurrentUser();
  // Not logged in: go to the login page, with "next" set so they come back to the membership page afterwards.
  if (!user) redirect(`/account/login?next=${encodeURIComponent("/data-intelligence/membership")}`);
  // Already a member: no need to pay again; go straight to the reports section.
  if (await hasDataMembership(user)) redirect("/data-intelligence#reports");

  // No Stripe configured: jump to the contact form on the membership page instead.
  const stripe = membershipStripe();
  if (!stripe) redirect("/data-intelligence/membership#contact");

  const base = siteUrl();
  // The admin's Stripe webhook links the subscription to this account via the metadata.
  // (Metadata = our own labels attached to the Stripe objects; Stripe sends them back to us in its notifications.)
  const metadata = { fundhub_user_id: String(user.id), plan: "data_member" };
  // Ask Stripe (over the internet) to create the checkout page. Each option, in order:
  // a recurring subscription; one unit of our membership price; pre-fill the user's email; our user id as a
  // reference; labels on the checkout and on the subscription it creates; ask for a billing address and an
  // optional VAT number (business buyers); allow discount codes; where to return after paying or cancelling.
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: membershipPrice()!, quantity: 1 }],
    customer_email: user.email,
    client_reference_id: String(user.id),
    metadata,
    subscription_data: { metadata },
    billing_address_collection: "required",
    tax_id_collection: { enabled: true },
    allow_promotion_codes: true,
    success_url: `${base}/data-intelligence/membership?status=success`,
    cancel_url: `${base}/data-intelligence/membership?status=cancelled`,
  });
  // Send the visitor to Stripe's payment page. `!` because Stripe always gives a URL for this kind of session.
  redirect(session.url!);
}
