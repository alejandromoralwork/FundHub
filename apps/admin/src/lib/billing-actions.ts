"use server";

/**
 * FILE: apps/admin/src/lib/billing-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Billing actions used by the Console's Billing page. Staff can create a Stripe customer for a
 *   service provider, start a quarterly "Pro" subscription, send a one-off advisory invoice, email a payment
 *   reminder, and pull the latest subscriptions/invoices from Stripe into our own database.
 * WHERE IT RUNS: only on the server (Node.js). It uses the secret Stripe key and the database.
 * FRAMEWORK NOTES: `"use server";` (must stay the first line) marks every exported function as a Next.js
 *   "server action": the browser can call it like a normal function, but the code runs on the server via a
 *   hidden HTTP request. Because anyone could send that request, each action first calls
 *   `requireStaff(CAN.billing)`, which only lets through signed-in staff whose role has billing rights.
 *   `revalidatePath("/billing")` tells Next.js its cached copy of the Billing page is out of date, so the next
 *   view shows the fresh data.
 *   Stripe is the payments company that holds customers, subscriptions and invoices; we talk to it through
 *   its official Node.js library (wrapped in ./stripe.ts).
 *   Zod (npm library) describes what valid input looks like and checks incoming data against it.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases with optional fields, `Record<string, unknown>` for untrusted input.
 *   - async/await, `Promise<T>`, ternary, `??`, `||`, optional chaining `?.`, non-null `!`.
 *   - Zod schemas: `z.object`, `z.coerce.number()`, `.safeParse`.
 *   - number literals with separators (`1_000_000` = one million), template strings.
 */

// `import { a } from "b"` brings named things from module b into this file.
// Drizzle ORM: `eq(column, value)` = SQL "column = value".
import { eq } from "drizzle-orm";
// Next.js: mark a page's cached version as stale (see FRAMEWORK NOTES).
import { revalidatePath } from "next/cache";
// Zod: input validation library (npm).
import { z } from "zod";
// `@fundhub/…` = our shared packages. The list of Pro subscription tiers.
import { PRO_TIERS } from "@fundhub/core/enums";
// The database connection and the tables used here.
import { db } from "@fundhub/db/client";
import { billingCustomers, invoices, providers } from "@fundhub/db/schema";
// Sends a templated email (React Email + Resend).
import { sendEmail } from "@fundhub/email/send";
// `./…` = this folder. Audit log writer; role check and permission table; Stripe helpers.
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";
import { getStripe, syncAll, tierPrice, upsertInvoice, upsertSubscription } from "./stripe";

/**
 * Kind: type alias (exported).
 * What every action returns to the page: an `ok` success message or an `error` message (both optional).
 */
export type ActionResult = { ok?: string; error?: string };

/** Kind: constant. The error returned when the Stripe secret key is missing (e.g. on a test setup). */
const NOT_CONFIGURED = { error: "Stripe isn't configured (STRIPE_SECRET_KEY)." };

/**
 * Kind: constant (Zod schema).
 * Rules for the "new customer" form:
 * - `providerId`: optional; `z.coerce.number()` turns text like "12" into the number 12, then it must be a
 *   positive whole number.
 * - `name`: text, spaces trimmed, 2–200 characters (the string is the error message shown to staff).
 * - `email`: must look like an email address.
 * - `vatNumber`: optional, at most 40 characters, or an empty string (`.or(z.literal(""))`).
 */
const customerSchema = z.object({
  providerId: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(2, "Name is required").max(200),
  email: z.string().trim().email("Valid billing email required"),
  vatNumber: z.string().trim().max(40).optional().or(z.literal("")),
});

/**
 * Kind: server action.
 * Creates a billing customer in Stripe and mirrors it in our database.
 * @param input  type `Record<string, unknown>` — the raw form values (untrusted, so validated below).
 * @returns `Promise<ActionResult>`.
 */
export async function createCustomer(input: Record<string, unknown>): Promise<ActionResult> {
  // Security: only signed-in staff with billing rights (owner, sales) get past this line.
  const staff = await requireStaff(CAN.billing);
  // The Stripe client, or null when the key is not set.
  const stripe = getStripe();
  if (!stripe) return NOT_CONFIGURED;
  // `.safeParse` checks the input without throwing: it returns `{ success: true, data }` or
  // `{ success: false, error }`. We show the first problem's message. `?.` guards an empty list.
  const parsed = customerSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  // `d` = the cleaned, correctly typed data.
  const d = parsed.data;

  // Create the customer at Stripe. `metadata` is free-form labels stored with it, so a Stripe record can be
  // traced back to our provider. Ternary: the provider id as text, or "" when there is none.
  const customer = await stripe.customers.create({
    name: d.name,
    email: d.email,
    metadata: { providerId: d.providerId ? String(d.providerId) : "", source: "fundhub-admin" },
    // EU VAT ids let Stripe Tax apply reverse charge for B2B customers outside Luxembourg.
    // `undefined` means "leave this option out".
    tax_id_data: d.vatNumber ? [{ type: "eu_vat", value: d.vatNumber }] : undefined,
  });
  // Keep our own copy, linked by Stripe's customer id. `?? null` / `|| null` store "nothing" instead of
  // undefined or an empty string.
  await db.insert(billingCustomers).values({ stripeCustomerId: customer.id, providerId: d.providerId ?? null, name: d.name, email: d.email, vatNumber: d.vatNumber || null });
  // Record who created it.
  await audit(staff, "create", "billing_customers", customer.id, { name: d.name });
  // Refresh the Billing page.
  revalidatePath("/billing");
  return { ok: `Customer ${d.name} created in Stripe.` };
}

/**
 * Kind: constant (Zod schema).
 * A subscription needs our customer id (a positive whole number) and a tier, which must be one of PRO_TIERS
 * (`z.enum(list)` = "one of these exact values").
 */
const subscriptionSchema = z.object({ customerId: z.coerce.number().int().positive(), tier: z.enum(PRO_TIERS) });

/**
 * Kind: server action.
 * Pro subscription, invoiced quarterly (payment by bank transfer/SEPA/card through Stripe's hosted invoice).
 * @param input  type `Record<string, unknown>` — `customerId` and `tier`.
 * @returns `Promise<ActionResult>`.
 */
export async function createSubscription(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.billing);
  const stripe = getStripe();
  if (!stripe) return NOT_CONFIGURED;
  const parsed = subscriptionSchema.safeParse(input);
  if (!parsed.success) return { error: "Choose a customer and a tier" };
  // The Stripe price id for this tier comes from an environment variable (see ./stripe.ts).
  const price = tierPrice(parsed.data.tier);
  if (!price) return { error: `Set STRIPE_PRICE_${parsed.data.tier.toUpperCase()} to the Stripe price id first.` };
  // Load our customer row (to get its Stripe id).
  const [customer] = await db.select().from(billingCustomers).where(eq(billingCustomers.id, parsed.data.customerId));
  if (!customer) return { error: "Customer not found" };

  // Create the subscription at Stripe.
  const sub = await stripe.subscriptions.create({
    customer: customer.stripeCustomerId,
    // One line item: the tier's price (its billing period, quarterly, is set on the price in Stripe).
    items: [{ price }],
    // Stripe emails an invoice to pay (rather than charging a saved card automatically), due in 30 days.
    collection_method: "send_invoice",
    days_until_due: 30,
    // Let Stripe calculate VAT only if the STRIPE_TAX setting is "on".
    automatic_tax: { enabled: process.env.STRIPE_TAX === "on" },
    metadata: { tier: parsed.data.tier, providerId: customer.providerId ? String(customer.providerId) : "" },
  });
  // Save/refresh our copy of the subscription ("upsert" = insert or update).
  await upsertSubscription(sub);
  await audit(staff, "create", "subscriptions", sub.id, { customer: customer.name, tier: parsed.data.tier });
  revalidatePath("/billing");
  // `.replace("_", "-")` makes a tier name like "x_y" read as "x-y" in the message.
  return { ok: `Pro ${parsed.data.tier.replace("_", "-")} subscription created for ${customer.name}.` };
}

/**
 * Kind: constant (Zod schema).
 * A one-off invoice: customer id, a description (3–500 characters), an amount in euros (positive, max one
 * million) and days until due (1–120; `.default(30)` fills in 30 when not given).
 */
const invoiceSchema = z.object({
  customerId: z.coerce.number().int().positive(),
  description: z.string().trim().min(3, "Describe the service").max(500),
  amount: z.coerce.number().positive("Amount must be positive").max(1_000_000),
  daysUntilDue: z.coerce.number().int().min(1).max(120).default(30),
});

/**
 * Kind: server action.
 * One-off advisory invoice (flat fee or success fee), finalized and emailed by Stripe.
 * @param input  type `Record<string, unknown>` — see invoiceSchema.
 * @returns `Promise<ActionResult>`.
 */
export async function createInvoice(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.billing);
  const stripe = getStripe();
  if (!stripe) return NOT_CONFIGURED;
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const [customer] = await db.select().from(billingCustomers).where(eq(billingCustomers.id, d.customerId));
  if (!customer) return { error: "Customer not found" };

  // Stripe invoices go through stages: 1) create a draft invoice…
  const draft = await stripe.invoices.create({
    customer: customer.stripeCustomerId,
    collection_method: "send_invoice",
    days_until_due: d.daysUntilDue,
    description: d.description,
    automatic_tax: { enabled: process.env.STRIPE_TAX === "on" },
    metadata: { source: "fundhub-admin", createdBy: staff.email },
  });
  // 2) …add the line item. Stripe counts money in the smallest unit (cents), so euros × 100, rounded to
  // avoid fractions caused by decimal arithmetic.
  await stripe.invoiceItems.create({
    customer: customer.stripeCustomerId,
    invoice: draft.id,
    amount: Math.round(d.amount * 100),
    currency: "eur",
    description: d.description,
  });
  // 3) finalise it (it gets a number and can no longer be edited), 4) have Stripe email it.
  // `draft.id!` — the `!` tells TypeScript the id is definitely there (Stripe's type says it might not be).
  const finalized = await stripe.invoices.finalizeInvoice(draft.id!);
  const sent = await stripe.invoices.sendInvoice(finalized.id!);
  // Store our copy, then audit.
  await upsertInvoice(sent);
  await audit(staff, "create", "invoices", sent.id, { customer: customer.name, amount: d.amount, description: d.description });
  revalidatePath("/billing");
  // `toLocaleString("en-GB")` formats the number British-style, e.g. 12,500.
  return { ok: `Invoice ${sent.number ?? ""} for €${d.amount.toLocaleString("en-GB")} sent to ${customer.email}.` };
}

/**
 * Kind: server action.
 * Emails a payment reminder for an open invoice, with Stripe's online payment link.
 * @param invoiceId  type `number` — our invoice row id.
 * @returns `Promise<ActionResult>`.
 */
export async function sendInvoiceReminder(invoiceId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.billing);
  // Load the invoice together with its customer: `{ inv: invoices, customer: billingCustomers }` returns both
  // full rows side by side, joined on the customer id.
  const [row] = await db
    .select({ inv: invoices, customer: billingCustomers })
    .from(invoices)
    .innerJoin(billingCustomers, eq(billingCustomers.id, invoices.customerId))
    .where(eq(invoices.id, invoiceId));
  // `row?.inv.hostedInvoiceUrl`: undefined if no row, or if the invoice has no payment page.
  if (!row?.inv.hostedInvoiceUrl) return { error: "Invoice not found or has no payment link." };
  const res = await sendEmail({
    to: row.customer.email,
    toName: row.customer.name,
    template: "invoice-reminder",
    props: {
      name: row.customer.name,
      // Our invoice number, or Stripe's id if it has none.
      invoiceNumber: row.inv.number ?? row.inv.stripeInvoiceId,
      // Outstanding amount = due − paid, converted from cents to euros, always with 2 decimals.
      amount: `€${((row.inv.amountDue - row.inv.amountPaid) / 100).toLocaleString("en-GB", { minimumFractionDigits: 2 })}`,
      // Date written British-style (day/month/year), or "on receipt" when there is no due date.
      dueDate: row.inv.dueDate ? row.inv.dueDate.toLocaleDateString("en-GB") : "on receipt",
      payUrl: row.inv.hostedInvoiceUrl,
    },
    // Links the email log entry to this invoice and to the staff member who sent it.
    related: { entity: "invoices", id: invoiceId },
    sentBy: staff.id,
  });
  await audit(staff, "reminder", "invoices", invoiceId);
  // `sendEmail` reports success or failure instead of throwing; pass that on.
  return res.ok ? { ok: `Reminder sent to ${row.customer.email}.` } : { error: res.error };
}

/**
 * Kind: server action.
 * Downloads all customers, subscriptions and invoices from Stripe into our database, in case something was
 * changed directly in Stripe's dashboard.
 * @returns `Promise<ActionResult>` with counts of what was synced.
 */
export async function syncFromStripe(): Promise<ActionResult> {
  const staff = await requireStaff(CAN.billing);
  const stripe = getStripe();
  if (!stripe) return NOT_CONFIGURED;
  const r = await syncAll(stripe);
  // The counts are stored as the audit "changes"; `null` = no single row is affected.
  await audit(staff, "sync", "billing", null, r);
  revalidatePath("/billing");
  return { ok: `Synced ${r.subscriptions} subscriptions and ${r.invoices} invoices for ${r.customers} customers.` };
}

/**
 * Kind: server action.
 * Provider list for the "new customer" form.
 * @returns `Promise<{ id, name, website }[]>`: every provider, sorted by name.
 * It is a server action (not a plain function) so the browser-side form can fetch it; the permission check
 * still applies.
 */
export async function providerOptions() {
  await requireStaff(CAN.billing);
  return db.select({ id: providers.id, name: providers.name, website: providers.website }).from(providers).orderBy(providers.name);
}
