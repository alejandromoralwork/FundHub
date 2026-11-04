/**
 * FILE: apps/admin/src/lib/stripe.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Connects the Console to Stripe (the payment service FundHub uses for subscriptions and invoices)
 *   and keeps a local copy ("mirror") of Stripe's subscriptions and invoices in our own database, so the
 *   Console's billing, finance and dashboard pages can query them quickly with SQL.
 * WHERE IT RUNS: only on the server (Node.js), because it uses the secret Stripe API key.
 * FRAMEWORK NOTES: `import "server-only"` makes the build fail if browser code ever imports this file, so the
 *   secret key can never end up in the browser. The upsert functions are called by the Stripe webhook route
 *   (Stripe notifies us of changes) and by `syncAll` (a manual full refresh).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import Stripe from "stripe"`: a "default" import (the library's main export), used both as a class
 *     (`new Stripe(key)`) and as a namespace of types (`Stripe.Subscription`, `Stripe.Invoice`).
 *   - `Stripe | null` unions, `??=`, `??`, `?.`, non-null `!`, `as unknown as { … }` assertions.
 *   - indexing an object literal by a key `{ … }[tier]`, `.find`, `.reduce`.
 *   - `for await (… of …)`: loop over items that arrive page by page from an API.
 */

// Side-effect import: the server-only guard (exports nothing).
import "server-only";
// `import { a } from "b"` brings in named exports. Drizzle ORM's `eq` = SQL "column = value".
import { eq } from "drizzle-orm";
// The official Stripe library from npm.
import Stripe from "stripe";
// Pro tier names, and the types of a tier and of any subscription plan (shared core package).
import { PRO_TIERS, type ProTier, type SubscriptionPlan } from "@fundhub/core/enums";
// Database connection and our three billing mirror tables.
import { db } from "@fundhub/db/client";
import { billingCustomers, invoices, subscriptions } from "@fundhub/db/schema";

/**
 * Kind: constant.
 * Keeps one Stripe client on the global object, so development reloads reuse it instead of creating new ones.
 */
const globalForStripe = globalThis as unknown as { stripe?: Stripe };

/**
 * Kind: function.
 * Null when STRIPE_SECRET_KEY isn't configured (the billing page then shows setup steps).
 * @returns `Stripe | null` — a ready Stripe client, or `null` when billing is not set up.
 */
export function getStripe(): Stripe | null {
  // The secret key comes from an environment variable, never from the code.
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  // `??=`: create the client only the first time.
  globalForStripe.stripe ??= new Stripe(key);
  return globalForStripe.stripe;
}

/**
 * Kind: function.
 * Quarterly Pro prices, created in the Stripe dashboard (Products → FundHub Pro).
 * @param tier  `ProTier` — "boutique" | "mid_market" | "institutional".
 * @returns     `string | undefined` — the Stripe price id for that tier, or undefined if not configured.
 * It builds a small object of tier → price id and immediately picks the entry for `tier` with `[tier]`.
 */
export function tierPrice(tier: ProTier): string | undefined {
  return {
    boutique: process.env.STRIPE_PRICE_BOUTIQUE,
    mid_market: process.env.STRIPE_PRICE_MID_MARKET,
    institutional: process.env.STRIPE_PRICE_INSTITUTIONAL,
  }[tier];
}

/**
 * Kind: function (private).
 * Pro tier from the price, or a Data Intelligence membership (price or checkout metadata from the website).
 * @param sub      `Stripe.Subscription` — the subscription from Stripe.
 * @param priceId  `string | undefined` — the price id of its first item.
 * @returns        `SubscriptionPlan | null` — which FundHub plan it is, or `null` if unknown.
 */
function planOf(sub: Stripe.Subscription, priceId: string | undefined): SubscriptionPlan | null {
  // `metadata` = extra key/values our website attaches at checkout. Either signal means a data membership.
  if (sub.metadata?.plan === "data_member" || (priceId && priceId === process.env.STRIPE_PRICE_DATA_MEMBERSHIP)) return "data_member";
  // `.find` returns the first tier whose price id matches, or `undefined` (turned into `null` by `??`).
  return PRO_TIERS.find((t) => tierPrice(t) === priceId) ?? null;
}

/**
 * Kind: constant holding an arrow function.
 * Stripe gives times as seconds since 1 January 1970; JavaScript `Date` uses milliseconds, hence `* 1000`.
 * Returns `null` when there is no time.
 */
const toDate = (sec: number | null | undefined) => (sec ? new Date(sec * 1000) : null);

/**
 * Kind: async function (private).
 * Finds our own customer id for a Stripe customer id.
 * @param stripeCustomerId  `string` — e.g. "cus_123…".
 * @returns                 `Promise<number | null>` — our `billing_customers.id`, or `null` if we do not know them.
 */
async function localCustomerId(stripeCustomerId: string): Promise<number | null> {
  const [row] = await db.select({ id: billingCustomers.id }).from(billingCustomers).where(eq(billingCustomers.stripeCustomerId, stripeCustomerId));
  return row?.id ?? null;
}

/**
 * Kind: constant holding an arrow function.
 * Stripe's `customer` field can be just the id text, a full customer object, a deleted-customer object, or null.
 * This returns the id in every case (`typeof c === "string"` checks which form we have), or `null`.
 */
const customerIdOf = (c: string | Stripe.Customer | Stripe.DeletedCustomer | null) => (typeof c === "string" ? c : c?.id ?? null);

/**
 * Kind: async function (private).
 * Website memberships start in Stripe Checkout: create the local customer, linked to the website account.
 * @param sub               `Stripe.Subscription` — carries `fundhub_user_id` in its metadata from the website.
 * @param stripeCustomerId  `string`.
 * @returns                 `Promise<number | null>` — the new (or existing) local customer id, or `null`.
 */
async function customerFromMembership(sub: Stripe.Subscription, stripeCustomerId: string): Promise<number | null> {
  // Metadata values are text; `Number(…)` converts it (gives NaN, which counts as false, if missing).
  const userId = Number(sub.metadata?.fundhub_user_id);
  const stripe = getStripe();
  // Not a website membership, or Stripe not configured: nothing to create.
  if (!userId || !stripe) return null;
  // Ask Stripe for the customer's name and email.
  const c = await stripe.customers.retrieve(stripeCustomerId);
  if (c.deleted) return null;
  // Upsert: insert, or if this Stripe customer already exists locally, just link it to the user.
  // Name fallback chain with `||`: name, else email, else "Member 12".
  const [row] = await db
    .insert(billingCustomers)
    .values({ stripeCustomerId, userId, name: c.name || c.email || `Member ${userId}`, email: c.email ?? "" })
    .onConflictDoUpdate({ target: billingCustomers.stripeCustomerId, set: { userId } })
    .returning({ id: billingCustomers.id });
  return row.id;
}

/**
 * Kind: async function (exported).
 * Saves (inserts or updates) one Stripe subscription into our `subscriptions` table.
 * Customers we do not know are ignored, because the Stripe account may also be used for other things.
 * @param sub  `Stripe.Subscription`.
 * @returns    `Promise<void>` — nothing; it only writes to the database.
 */
export async function upsertSubscription(sub: Stripe.Subscription) {
  // A subscription always has a customer, hence the `!` ("not null").
  const stripeCustomerId = customerIdOf(sub.customer)!;
  // Known customer? If not (`??`), try creating one from website-membership metadata.
  const customerId = (await localCustomerId(stripeCustomerId)) ?? (await customerFromMembership(sub, stripeCustomerId));
  if (!customerId) return; // not one of ours
  // FundHub subscriptions have one line item (the plan).
  const item = sub.items.data[0];
  // Billing interval: "every 3 months" is stored as "quarter"; otherwise Stripe's interval (e.g. "year"),
  // defaulting to "quarter".
  const interval = item?.price.recurring?.interval === "month" && item.price.recurring.interval_count === 3 ? "quarter" : item?.price.recurring?.interval ?? "quarter";
  // Newer API versions report the period on the item; older ones on the subscription.
  // The `as unknown as { … }` casts are needed because the installed Stripe types list the field in only one place.
  const periodEnd = (item as unknown as { current_period_end?: number })?.current_period_end ?? (sub as unknown as { current_period_end?: number }).current_period_end;
  const values = {
    customerId,
    tier: planOf(sub, item?.price.id),
    status: sub.status,
    // Amount per period in cents: unit price × quantity.
    amount: (item?.price.unit_amount ?? 0) * (item?.quantity ?? 1),
    currency: item?.price.currency ?? "eur",
    interval,
    currentPeriodEnd: toDate(periodEnd),
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
  // Upsert keyed on Stripe's subscription id: the first time inserts, later events update the same row.
  await db
    .insert(subscriptions)
    .values({ stripeSubscriptionId: sub.id, ...values })
    .onConflictDoUpdate({ target: subscriptions.stripeSubscriptionId, set: values });
}

/**
 * Kind: async function (exported).
 * Saves (inserts or updates) one Stripe invoice into our `invoices` table. Unknown customers are ignored.
 * @param inv  `Stripe.Invoice`.
 * @returns    `Promise<void>`.
 */
export async function upsertInvoice(inv: Stripe.Invoice) {
  // Draft "upcoming" invoices may have no id yet; skip those.
  if (!inv.id) return;
  const customerId = await localCustomerId(customerIdOf(inv.customer)!);
  if (!customerId) return;
  const values = {
    customerId,
    number: inv.number,
    // The invoice's description, else the first line's description, else null.
    description: inv.description ?? inv.lines?.data[0]?.description ?? null,
    status: inv.status ?? "draft",
    // All amounts are in cents, as Stripe sends them.
    amountDue: inv.amount_due,
    amountPaid: inv.amount_paid,
    // Newer API versions report taxes as a list; older ones as a single number.
    // `.reduce((sum, t) => sum + t.amount, 0)` adds up the list, starting from 0.
    taxAmount:
      (inv as unknown as { total_taxes?: { amount: number }[] }).total_taxes?.reduce((sum, t) => sum + t.amount, 0) ??
      (inv as unknown as { tax?: number | null }).tax ??
      0,
    currency: inv.currency,
    // Links to Stripe's own invoice page and PDF.
    hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
    invoicePdf: inv.invoice_pdf ?? null,
    dueDate: toDate(inv.due_date),
  };
  await db.insert(invoices).values({ stripeInvoiceId: inv.id, ...values }).onConflictDoUpdate({ target: invoices.stripeInvoiceId, set: values });
}

/**
 * Kind: async function (exported).
 * Pulls every known customer's subscriptions and invoices (backfill / when webhooks are off).
 * @param stripe  `Stripe` — a ready client (from `getStripe`).
 * @returns       `Promise<{ customers: number; subscriptions: number; invoices: number }>` — how many were synced.
 */
export async function syncAll(stripe: Stripe) {
  const customers = await db.select().from(billingCustomers);
  // Counters; `let` because they change, `++` adds one.
  let subs = 0;
  let invs = 0;
  for (const c of customers) {
    // Stripe returns lists in pages of up to 100. `for await` lets the library fetch the next page
    // automatically as the loop goes on. `status: "all"` includes cancelled subscriptions too.
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
