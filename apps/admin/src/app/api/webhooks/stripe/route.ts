/**
 * FILE: apps/admin/src/app/api/webhooks/stripe/route.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Receives notifications ("webhooks") from Stripe, the card-payment service, whenever a
 *   subscription or invoice changes. It checks Stripe's signature, then copies the changed subscription or
 *   invoice into our own database tables, so the Billing page always shows up-to-date information.
 * WHERE IT RUNS: on the server (Node.js) only. Stripe's servers call /admin/api/webhooks/stripe; there is no
 *   logged-in user, so the signature check is what keeps it safe.
 * FRAMEWORK NOTES: route.ts = an API endpoint; the exported POST function answers HTTP POST requests.
 * TYPESCRIPT YOU WILL SEE HERE: `import type` of a default export, `let` with a declared type
 *   (`let event: Stripe.Event`), `try/catch` without an error variable, `??`, `as` assertions, if/else if.
 */

// `import { a } from "b"` loads named exports from module "b".
// `NextResponse` builds HTTP responses.
import { NextResponse } from "next/server";
// `import type Stripe from "stripe"`: only the TypeScript types of the Stripe library (no code is loaded);
// used for `Stripe.Event`, `Stripe.Subscription` and `Stripe.Invoice` below.
import type Stripe from "stripe";
// `@/…` = this app's src folder. getStripe = the Stripe client (null if not configured);
// upsertSubscription / upsertInvoice = insert-or-update one record in our database.
import { getStripe, upsertInvoice, upsertSubscription } from "@/lib/stripe";

/**
 * Kind: async function — the HTTP POST handler Stripe calls.
 * Keeps the local billing mirror in sync. Configure in Stripe → Developers → Webhooks.
 * @param req  type `Request` — the webhook call from Stripe.
 * @returns    `Promise<Response>`: `{ received: true }`, or 503 (not configured) / 400 (bad signature).
 */
export async function POST(req: Request) {
  const stripe = getStripe();
  // The signing secret Stripe gave us for this webhook (a server setting).
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  // 503 = "service unavailable": Stripe is not set up on this server.
  if (!stripe || !secret) return NextResponse.json({ message: "Stripe not configured" }, { status: 503 });

  // `let` (unlike `const`) declares a variable that is assigned later — here inside the `try` block.
  // `: Stripe.Event` declares its type up front.
  let event: Stripe.Event;
  try {
    // Stripe's library checks the "stripe-signature" header against the raw body text and our secret, and
    // returns the parsed event. If the header is missing, `?? ""` passes an empty string, which fails the check.
    event = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    // Any failure of the check lands here (`catch` without a variable: we do not need the error itself).
    return NextResponse.json({ message: "Invalid signature" }, { status: 400 });
  }

  // Event names look like "customer.subscription.updated" or "invoice.paid". `startsWith` picks the family.
  // `event.data.object as Stripe.Subscription` tells TypeScript which kind of object this event carries.
  if (event.type.startsWith("customer.subscription.")) await upsertSubscription(event.data.object as Stripe.Subscription);
  else if (event.type.startsWith("invoice.")) await upsertInvoice(event.data.object as Stripe.Invoice);
  // Other events are acknowledged but ignored. Answering 200 stops Stripe from retrying.
  return NextResponse.json({ received: true });
}
