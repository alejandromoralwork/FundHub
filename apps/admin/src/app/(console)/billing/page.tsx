/**
 * FILE: apps/admin/src/app/(console)/billing/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Billing & invoices" page. It loads, in parallel, the paying customers, their Pro
 *   subscriptions, the latest 500 invoices and the list of providers, plus whether Stripe (the card-payment
 *   service) is set up, and hands all of it to the billing screen component.
 * WHERE IT RUNS: on the server (Node.js), as a server component: it reads the database and secret Stripe
 *   settings, which must never reach the browser. The BillingView component it renders runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/billing = the URL /admin/billing ("(console)" is a route group,
 *   left out of the URL; /admin is the Console's basePath).
 * TYPESCRIPT YOU WILL SEE HERE: `async`/`await`, `Promise.all` with array destructuring, generic functions
 *   `<T,>`, the `unknown` type, `as` assertions, `!!x` (turn into true/false), ternaries `c ? x : y`,
 *   `?? ""`, arrow functions `(t) => …`, `.map`, `Object.fromEntries`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM (npm library that writes SQL): `desc` = sort newest/largest first, `eq` = "equals".
import { desc, eq } from "drizzle-orm";
// `@fundhub/…` = our shared packages. PRO_TIERS is the list of paid plan names (e.g. the Pro tiers).
import { PRO_TIERS } from "@fundhub/core/enums";
// Database connection.
import { db } from "@fundhub/db/client";
// Table definitions used below.
import { billingCustomers, invoices, providers, subscriptions } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The billing screen, plus the TypeScript types of its three kinds of rows.
import { BillingView, type CustomerRow, type InvoiceRow, type SubRow } from "@/components/billing-views";
// `CAN` = the table of which staff roles may do what; `requireStaff` = login/role check.
import { CAN, requireStaff } from "@/lib/auth";
// `getStripe()` returns a Stripe client (or null if not configured); `tierPrice(t)` = the Stripe price id for a tier.
import { getStripe, tierPrice } from "@/lib/stripe";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Billing & invoices" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the billing screen markup, arriving later because the function is `async`.
 */
export default async function BillingPage() {
  // Only roles listed in CAN.billing (owner and sales) may see this; others are redirected.
  await requireStaff(CAN.billing);
  // `!!x` turns any value into true/false: true when a Stripe client exists (i.e. a secret key is set).
  const configured = !!getStripe();
  // `Promise.all([...])` starts the four database queries at the same time and waits for all of them,
  // which is faster than running them one after another. The results come back as an array in the same
  // order; `const [customers, subs, invs, providerList] = …` (array destructuring) names each one.
  const [customers, subs, invs, providerList] = await Promise.all([
    // 1) Billing customers, with the name of the provider each one is linked to (leftJoin: the provider
    //    may be missing, then providerName is null). Sorted alphabetically by customer name.
    db
      .select({ id: billingCustomers.id, stripeCustomerId: billingCustomers.stripeCustomerId, name: billingCustomers.name, email: billingCustomers.email, vatNumber: billingCustomers.vatNumber, providerName: providers.name, createdAt: billingCustomers.createdAt })
      .from(billingCustomers)
      .leftJoin(providers, eq(providers.id, billingCustomers.providerId))
      .orderBy(billingCustomers.name),
    // 2) Subscriptions, with the customer's name. `innerJoin` only keeps subscriptions that have a matching
    //    customer. Most recently updated first.
    db
      .select({ id: subscriptions.id, stripeSubscriptionId: subscriptions.stripeSubscriptionId, customerName: billingCustomers.name, tier: subscriptions.tier, status: subscriptions.status, amount: subscriptions.amount, interval: subscriptions.interval, currentPeriodEnd: subscriptions.currentPeriodEnd, cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd })
      .from(subscriptions)
      .innerJoin(billingCustomers, eq(billingCustomers.id, subscriptions.customerId))
      .orderBy(desc(subscriptions.updatedAt)),
    // 3) The 500 newest invoices, with the customer's name and links to Stripe's invoice page and PDF.
    db
      .select({ id: invoices.id, number: invoices.number, customerName: billingCustomers.name, description: invoices.description, status: invoices.status, amountDue: invoices.amountDue, amountPaid: invoices.amountPaid, hostedInvoiceUrl: invoices.hostedInvoiceUrl, invoicePdf: invoices.invoicePdf, dueDate: invoices.dueDate, createdAt: invoices.createdAt })
      .from(invoices)
      .innerJoin(billingCustomers, eq(billingCustomers.id, invoices.customerId))
      .orderBy(desc(invoices.createdAt))
      .limit(500),
    // 4) Every provider's id and name, for the "link customer to provider" picker.
    db.select({ id: providers.id, name: providers.name }).from(providers).orderBy(providers.name),
  ]);
  // `plain` is a small arrow function (`(x) => …` is a function written inline).
  // `<T,>` makes it generic: the caller picks the result type T, e.g. `plain<SubRow[]>(subs)`.
  // (The comma in `<T,>` is needed in .tsx files so `<T>` is not mistaken for a JSX tag.)
  // `x: unknown` = "any value, but you must not use it without checking". The JSON round-trip turns Dates
  // into strings so the data can travel to the browser component; `as T` labels the result with type T.
  const plain = <T,>(x: unknown) => JSON.parse(JSON.stringify(x)) as T;
  // The Stripe secret key from the server settings, or "" if not set (`??` = "if missing, use this").
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  // The markup. Note that only "live"/"test" is sent to the browser, never the key itself.
  // Notes on the props below:
  // - stripeMode: nested ternaries (`cond ? a : b`). No key -> null; a key starting "sk_live" -> "live"
  //   (real money); any other key -> "test" (Stripe's sandbox).
  // - pricesConfigured: `PRO_TIERS.map((t) => [t, !!tierPrice(t)])` makes a list of [tier, true/false]
  //   pairs, and `Object.fromEntries` turns those pairs into an object like { pro: true, … }, saying which
  //   tiers have a Stripe price set up.
  // - customers/subs/invoices: the query results made plain (see `plain` above); providers is already plain.
  return (
    <BillingView
      configured={configured}
      stripeMode={key ? (key.startsWith("sk_live") ? "live" : "test") : null}
      pricesConfigured={Object.fromEntries(PRO_TIERS.map((t) => [t, !!tierPrice(t)]))}
      customers={plain<CustomerRow[]>(customers)}
      subs={plain<SubRow[]>(subs)}
      invoices={plain<InvoiceRow[]>(invs)}
      providers={providerList}
    />
  );
}
