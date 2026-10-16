import "server-only";
import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { PRO_TIERS, type ProTier, type SubscriptionPlan } from "@fundhub/core/enums";
import { db } from "@fundhub/db/client";
import { billingCustomers, invoices, subscriptions } from "@fundhub/db/schema";

const globalForStripe = globalThis as unknown as { stripe?: Stripe };

/** Null when STRIPE_SECRET_KEY isn't configured (the billing page then shows setup steps). */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  globalForStripe.stripe ??= new Stripe(key);
  return globalForStripe.stripe;
}

/** Quarterly Pro prices, created in the Stripe dashboard (Products → FundHub Pro). */
export function tierPrice(tier: ProTier): string | undefined {
  return {
    boutique: process.env.STRIPE_PRICE_BOUTIQUE,
    mid_market: process.env.STRIPE_PRICE_MID_MARKET,
    institutional: process.env.STRIPE_PRICE_INSTITUTIONAL,
  }[tier];
}

/** Pro tier from the price, or a Data Intelligence membership (price or checkout metadata from the website). */
function planOf(sub: Stripe.Subscription, priceId: string | undefined): SubscriptionPlan | null {
  if (sub.metadata?.plan === "data_member" || (priceId && priceId === process.env.STRIPE_PRICE_DATA_MEMBERSHIP)) return "data_member";
  return PRO_TIERS.find((t) => tierPrice(t) === priceId) ?? null;
}

const toDate = (sec: number | null | undefined) => (sec ? new Date(sec * 1000) : null);

async function localCustomerId(stripeCustomerId: string): Promise<number | null> {
  const [row] = await db.select({ id: billingCustomers.id }).from(billingCustomers).where(eq(billingCustomers.stripeCustomerId, stripeCustomerId));
  return row?.id ?? null;
}

const customerIdOf = (c: string | Stripe.Customer | Stripe.DeletedCustomer | null) => (typeof c === "string" ? c : c?.id ?? null);

/** Website memberships start in Stripe Checkout: create the local customer, linked to the website account. */
async function customerFromMembership(sub: Stripe.Subscription, stripeCustomerId: string): Promise<number | null> {
  const userId = Number(sub.metadata?.fundhub_user_id);
  const stripe = getStripe();
  if (!userId || !stripe) return null;
  const c = await stripe.customers.retrieve(stripeCustomerId);
  if (c.deleted) return null;
  const [row] = await db
    .insert(billingCustomers)
    .values({ stripeCustomerId, userId, name: c.name || c.email || `Member ${userId}`, email: c.email ?? "" })
    .onConflictDoUpdate({ target: billingCustomers.stripeCustomerId, set: { userId } })
    .returning({ id: billingCustomers.id });
  return row.id;
}

export async function upsertSubscription(sub: Stripe.Subscription) {
  const stripeCustomerId = customerIdOf(sub.customer)!;
  const customerId = (await localCustomerId(stripeCustomerId)) ?? (await customerFromMembership(sub, stripeCustomerId));
  if (!customerId) return; // not one of ours
  const item = sub.items.data[0];
  const interval = item?.price.recurring?.interval === "month" && item.price.recurring.interval_count === 3 ? "quarter" : item?.price.recurring?.interval ?? "quarter";
  // Newer API versions report the period on the item; older ones on the subscription.
  const periodEnd = (item as unknown as { current_period_end?: number })?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const values = {
    customerId,
    tier: planOf(sub, item?.price.id),
    status: sub.status,
    amount: (item?.price.unit_amount ?? 0) * (item?.quantity ?? 1),
    currency: item?.price.currency ?? "eur",
    interval,
    currentPeriodEnd: toDate(periodEnd),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
  await db
    .insert(subscriptions)
    .values({ stripeSubscriptionId: sub.id, ...values })
    .onConflictDoUpdate({ target: subscriptions.stripeSubscriptionId, set: values });
}

export async function upsertInvoice(inv: Stripe.Invoice) {
  if (!inv.id) return;
  const customerId = await localCustomerId(customerIdOf(inv.customer)!);
  if (!customerId) return;
  const values = {
    customerId,
    number: inv.number,
    description: inv.description ?? inv.lines?.data[0]?.description ?? null,
    status: inv.status ?? "draft",
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    // Newer API versions report taxes as a list; older ones as a single number.
    taxAmount:
      (inv as unknown as { total_taxes?: { amount: number }[] }).total_taxes?.reduce((sum, t) => sum + t.amount, 0) ??
      (inv as unknown as { tax?: number | null }).tax ??
      0,
    currency: inv.currency,
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
    dueDate: toDate(inv.due_date),
  };
  await db.insert(invoices).values({ stripeInvoiceId: inv.id, ...values }).onConflictDoUpdate({ target: invoices.stripeInvoiceId, set: values });
}

/** Pulls every known customer's subscriptions and invoices (backfill / when webhooks are off). */
export async function syncAll(stripe: Stripe) {
  const customers = await db.select().from(billingCustomers);
  let subs = 0;
  let invs = 0;
  for (const c of customers) {
    for await (const s of stripe.subscriptions.list({ customer: c.stripeCustomerId, status: "all", limit: 100 })) {
      await upsertSubscription(s);
      subs++;
    }
    for await (const i of stripe.invoices.list({ customer: c.stripeCustomerId, limit: 100 })) {
      await upsertInvoice(i);
      invs++;
    }
  }
  return { customers: customers.length, subscriptions: subs, invoices: invs };
}
