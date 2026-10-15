import type { Metadata } from "next";
import { desc, eq } from "drizzle-orm";
import { PRO_TIERS } from "@fundhub/core/enums";
import { db } from "@fundhub/db/client";
import { billingCustomers, invoices, providers, subscriptions } from "@fundhub/db/schema";
import { BillingView, type CustomerRow, type InvoiceRow, type SubRow } from "@/components/billing-views";
import { CAN, requireStaff } from "@/lib/auth";
import { getStripe, tierPrice } from "@/lib/stripe";

export const metadata: Metadata = { title: "Billing & invoices" };

export default async function BillingPage() {
  await requireStaff(CAN.billing);
  const configured = !!getStripe();
  const [customers, subs, invs, providerList] = await Promise.all([
    db
      .select({ id: billingCustomers.id, stripeCustomerId: billingCustomers.stripeCustomerId, name: billingCustomers.name, email: billingCustomers.email, vatNumber: billingCustomers.vatNumber, providerName: providers.name, createdAt: billingCustomers.createdAt })
      .from(billingCustomers)
      .leftJoin(providers, eq(providers.id, billingCustomers.providerId))
      .orderBy(billingCustomers.name),
    db
      .select({ id: subscriptions.id, stripeSubscriptionId: subscriptions.stripeSubscriptionId, customerName: billingCustomers.name, tier: subscriptions.tier, status: subscriptions.status, amount: subscriptions.amount, interval: subscriptions.interval, currentPeriodEnd: subscriptions.currentPeriodEnd, cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd })
      .from(subscriptions)
      .innerJoin(billingCustomers, eq(billingCustomers.id, subscriptions.customerId))
      .orderBy(desc(subscriptions.updatedAt)),
    db
      .select({ id: invoices.id, number: invoices.number, customerName: billingCustomers.name, description: invoices.description, status: invoices.status, amountDue: invoices.amountDue, amountPaid: invoices.amountPaid, hostedInvoiceUrl: invoices.hostedInvoiceUrl, invoicePdf: invoices.invoicePdf, dueDate: invoices.dueDate, createdAt: invoices.createdAt })
      .from(invoices)
      .innerJoin(billingCustomers, eq(billingCustomers.id, invoices.customerId))
      .orderBy(desc(invoices.createdAt))
      .limit(500),
    db.select({ id: providers.id, name: providers.name }).from(providers).orderBy(providers.name),
  ]);
  const plain = <T,>(x: unknown) => JSON.parse(JSON.stringify(x)) as T;
  const key = process.env.STRIPE_SECRET_KEY ?? "";
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
