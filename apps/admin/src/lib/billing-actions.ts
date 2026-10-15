"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PRO_TIERS } from "@fundhub/core/enums";
import { db } from "@fundhub/db/client";
import { billingCustomers, invoices, providers } from "@fundhub/db/schema";
import { sendEmail } from "@fundhub/email/send";
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";
import { getStripe, syncAll, tierPrice, upsertInvoice, upsertSubscription } from "./stripe";

export type ActionResult = { ok?: string; error?: string };

const NOT_CONFIGURED = { error: "Stripe isn't configured (STRIPE_SECRET_KEY)." };

const customerSchema = z.object({
  providerId: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(2, "Name is required").max(200),
  email: z.string().trim().email("Valid billing email required"),
  vatNumber: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function createCustomer(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.billing);
  const stripe = getStripe();
  if (!stripe) return NOT_CONFIGURED;
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;

  const customer = await stripe.customers.create({
    name: d.name,
    email: d.email,
    metadata: { providerId: d.providerId ? String(d.providerId) : "", source: "fundhub-admin" },
    // EU VAT ids let Stripe Tax apply reverse charge for B2B customers outside Luxembourg.
    tax_id_data: d.vatNumber ? [{ type: "eu_vat", value: d.vatNumber }] : undefined,
  });
  await db.insert(billingCustomers).values({ stripeCustomerId: customer.id, providerId: d.providerId ?? null, name: d.name, email: d.email, vatNumber: d.vatNumber || null });
  await audit(staff, "create", "billing_customers", customer.id, { name: d.name });
  revalidatePath("/billing");
  return { ok: `Customer ${d.name} created in Stripe.` };
}

const subscriptionSchema = z.object({ customerId: z.coerce.number().int().positive(), tier: z.enum(PRO_TIERS) });

/** Pro subscription, invoiced quarterly (payment by bank transfer/SEPA/card through Stripe's hosted invoice). */
export async function createSubscription(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.billing);
  const stripe = getStripe();
  if (!stripe) return NOT_CONFIGURED;
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a customer and a tier" };
  const price = tierPrice(parsed.data.tier);
  if (!price) return { error: `Set STRIPE_PRICE_${parsed.data.tier.toUpperCase()} to the Stripe price id first.` };
  const [customer] = await db.select().from(billingCustomers).where(eq(billingCustomers.id, parsed.data.customerId));
  if (!customer) return { error: "Customer not found" };

  const sub = await stripe.subscriptions.create({
    customer: customer.stripeCustomerId,
    items: [{ price }],
    collection_method: "send_invoice",
    days_until_due: 30,
    automatic_tax: { enabled: process.env.STRIPE_TAX === "on" },
    metadata: { tier: parsed.data.tier, providerId: customer.providerId ? String(customer.providerId) : "" },
  });
  await upsertSubscription(sub);
  await audit(staff, "create", "subscriptions", sub.id, { customer: customer.name, tier: parsed.data.tier });
  revalidatePath("/billing");
  return { ok: `Pro ${parsed.data.tier.replace("_", "-")} subscription created for ${customer.name}.` };
}

const invoiceSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  description: z.string().trim().min(3, "Describe the service").max(500),
  amount: z.coerce.number().positive("Amount must be positive").max(1_000_000),
  daysUntilDue: z.coerce.number().int().min(1).max(120).default(30),
});

/** One-off advisory invoice (flat fee or success fee), finalized and emailed by Stripe. */
export async function createInvoice(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.billing);
  const stripe = getStripe();
  if (!stripe) return NOT_CONFIGURED;
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const [customer] = await db.select().from(billingCustomers).where(eq(billingCustomers.id, d.customerId));
  if (!customer) return { error: "Customer not found" };

  const draft = await stripe.invoices.create({
    customer: customer.stripeCustomerId,
    collection_method: "send_invoice",
    days_until_due: d.daysUntilDue,
    description: d.description,
    automatic_tax: { enabled: process.env.STRIPE_TAX === "on" },
    metadata: { source: "fundhub-admin", createdBy: staff.email },
  });
  await stripe.invoiceItems.create({
    customer: customer.stripeCustomerId,
    invoice: draft.id,
    amount: Math.round(d.amount * 100),
    currency: "eur",
    description: d.description,
  });
  const finalized = await stripe.invoices.finalizeInvoice(draft.id!);
  const sent = await stripe.invoices.sendInvoice(finalized.id!);
  await upsertInvoice(sent);
  await audit(staff, "create", "invoices", sent.id, { customer: customer.name, amount: d.amount, description: d.description });
  revalidatePath("/billing");
  return { ok: `Invoice ${sent.number ?? ""} for €${d.amount.toLocaleString("en-GB")} sent to ${customer.email}.` };
}

export async function sendInvoiceReminder(invoiceId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.billing);
  const [row] = await db
    .select({ inv: invoices, customer: billingCustomers })
    .from(invoices)
    .innerJoin(billingCustomers, eq(billingCustomers.id, invoices.customerId))
    .where(eq(invoices.id, invoiceId));
  if (!row?.inv.hostedInvoiceUrl) return { error: "Invoice not found or has no payment link." };
  const res = await sendEmail({
    to: row.customer.email,
    toName: row.customer.name,
    template: "invoice-reminder",
    props: {
      name: row.customer.name,
      invoiceNumber: row.inv.number ?? row.inv.stripeInvoiceId,
      amount: `€${((row.inv.amountDue - row.inv.amountPaid) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
      dueDate: row.inv.dueDate ? row.inv.dueDate.toLocaleDateString("en-GB") : "on receipt",
      payUrl: row.inv.hostedInvoiceUrl,
    },
    related: { entity: "invoices", id: invoiceId },
    sentBy: staff.id,
  });
  await audit(staff, "reminder", "invoices", invoiceId);
  return res.ok ? { ok: `Reminder sent to ${row.customer.email}.` } : { error: res.error };
}

export async function syncFromStripe(): Promise<ActionResult> {
  const staff = await requireStaff(CAN.billing);
  const stripe = getStripe();
  if (!stripe) return NOT_CONFIGURED;
  const r = await syncAll(stripe);
  await audit(staff, "sync", "billing", null, r);
  revalidatePath("/billing");
  return { ok: `Synced ${r.subscriptions} subscriptions and ${r.invoices} invoices for ${r.customers} customers.` };
}

/** Provider list for the "new customer" form. */
export async function providerOptions() {
  await requireStaff(CAN.billing);
  return db.select({ id: providers.id, name: providers.name, website: providers.website }).from(providers).orderBy(providers.name);
}
