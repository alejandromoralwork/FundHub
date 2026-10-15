import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, upsertInvoice, upsertSubscription } from "@/lib/stripe";

/** Keeps the local billing mirror in sync. Configure in Stripe → Developers → Webhooks. */
export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return NextResponse.json({ message: "Stripe not configured" }, { status: 503 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), req.headers.get("stripe-signature") ?? "", secret);
  } catch {
    return NextResponse.json({ message: "Invalid signature" }, { status: 400 });
  }

  if (event.type.startsWith("customer.subscription.")) await upsertSubscription(event.data.object as Stripe.Subscription);
  else if (event.type.startsWith("invoice.")) await upsertInvoice(event.data.object as Stripe.Invoice);
  return NextResponse.json({ received: true });
}
