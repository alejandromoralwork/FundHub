import "server-only";
import Stripe from "stripe";

const globalForStripe = globalThis as unknown as { stripe?: Stripe };

/** Stripe price for the Data Intelligence membership (Stripe dashboard → Products). */
export const membershipPrice = () => process.env.STRIPE_PRICE_DATA_MEMBERSHIP;

/** Null until STRIPE_SECRET_KEY and the membership price are set; the page then offers a contact form. */
export function membershipStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !membershipPrice()) return null;
  globalForStripe.stripe ??= new Stripe(key);
  return globalForStripe.stripe;
}
