"use server";

import { redirect } from "next/navigation";
import { getCurrentUser, hasDataMembership } from "./auth/session";
import { membershipPrice, membershipStripe } from "./membership";
import { siteUrl } from "./site";

/** Sends a logged-in user to Stripe Checkout for the Data Intelligence membership. */
export async function startMembershipCheckout() {
  const user = await getCurrentUser();
  if (!user) redirect(`/account/login?next=${encodeURIComponent("/data-intelligence/membership")}`);
  if (await hasDataMembership(user)) redirect("/data-intelligence#reports");

  const stripe = membershipStripe();
  if (!stripe) redirect("/data-intelligence/membership#contact");

  const base = siteUrl();
  // The admin's Stripe webhook links the subscription to this account via the metadata.
  const metadata = { fundhub_user_id: String(user.id), plan: "data_member" };
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
  redirect(session.url!);
}
