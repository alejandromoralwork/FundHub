"use server";

import { and, desc, eq, gte, lt } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES } from "@fundhub/core/enums";
import { db } from "@fundhub/db/client";
import { billingCustomers, budgets, expenses, invoices } from "@fundhub/db/schema";
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";

export type ActionResult = { ok?: string; error?: string };

const expenseSchema = z.object({
  id: z.number().int().positive().optional(),
  date: z.string().min(8),
  vendor: z.string().trim().min(2, "Vendor is required").max(160),
  category: z.enum(EXPENSE_CATEGORIES),
  description: z.string().trim().max(1000).default(""),
  amountNet: z.number().positive("Amount must be positive").max(10_000_000),
  vatRate: z.number().min(0).max(100),
  status: z.enum(EXPENSE_STATUSES).default("recorded"),
  recurring: z.boolean().default(false),
  receiptUrl: z.string().trim().max(1000).optional().or(z.literal("")),
});

/** Amounts arrive in euros from the form and are stored in cents; VAT is computed here. */
export async function saveExpense(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.finance);
  const parsed = expenseSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid expense" };
  const { id, amountNet, date, receiptUrl, ...rest } = parsed.data;
  const net = Math.round(amountNet * 100);
  const values = {
    ...rest,
    date: new Date(date),
    amountNet: net,
    vatAmount: Math.round((net * rest.vatRate) / 100),
    receiptUrl: receiptUrl || null,
  };
  if (id) {
    await db.update(expenses).set(values).where(eq(expenses.id, id));
    await audit(staff, "update", "expenses", id, { vendor: values.vendor, amountNet: net });
  } else {
    const [row] = await db.insert(expenses).values({ ...values, createdBy: staff.id }).returning({ id: expenses.id });
    await audit(staff, "create", "expenses", row.id, { vendor: values.vendor, amountNet: net });
  }
  revalidatePath("/finance");
  return { ok: "Expense saved." };
}

export async function deleteExpense(id: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.finance);
  await db.delete(expenses).where(eq(expenses.id, id));
  await audit(staff, "delete", "expenses", id);
  revalidatePath("/finance");
  return { ok: "Expense deleted." };
}

/** Copies last month's recurring expenses into the current month (skips ones already copied). */
export async function copyRecurring(): Promise<ActionResult> {
  const staff = await requireStaff(CAN.finance);
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [previous, current] = await Promise.all([
    db.select().from(expenses).where(and(eq(expenses.recurring, true), gte(expenses.date, lastMonth), lt(expenses.date, thisMonth))),
    db.select({ vendor: expenses.vendor, category: expenses.category }).from(expenses).where(and(eq(expenses.recurring, true), gte(expenses.date, thisMonth))),
  ]);
  const have = new Set(current.map((c) => `${c.vendor}|${c.category}`));
  const toCopy = previous.filter((p) => !have.has(`${p.vendor}|${p.category}`));
  for (const p of toCopy) {
    const date = new Date(p.date);
    date.setMonth(date.getMonth() + 1);
    await db.insert(expenses).values({
      date,
      vendor: p.vendor,
      category: p.category,
      description: p.description,
      amountNet: p.amountNet,
      vatRate: p.vatRate,
      vatAmount: p.vatAmount,
      recurring: true,
      status: "recorded",
      createdBy: staff.id,
    });
  }
  await audit(staff, "copy-recurring", "expenses", null, { copied: toCopy.length });
  revalidatePath("/finance");
  return { ok: toCopy.length ? `Copied ${toCopy.length} recurring expense(s) into this month.` : "Nothing to copy: this month is up to date." };
}

export async function saveBudget(input: { month: string; category: string; amount: number }): Promise<ActionResult> {
  const staff = await requireStaff(CAN.finance);
  const parsed = z
    .object({ month: z.string().regex(/^\d{4}-\d{2}$/), category: z.enum(EXPENSE_CATEGORIES), amount: z.number().min(0).max(10_000_000) })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid budget" };
  const cents = Math.round(parsed.data.amount * 100);
  await db
    .insert(budgets)
    .values({ ...parsed.data, amount: cents })
    .onConflictDoUpdate({ target: [budgets.month, budgets.category], set: { amount: cents } });
  await audit(staff, "budget", "budgets", null, { ...parsed.data });
  revalidatePath("/finance");
  return { ok: "Budget saved." };
}

const eur = (cents: number) => (cents / 100).toFixed(2);
const esc = (v: string | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** CSV exports for the accountant (and import into an accounting system later). */
export async function exportCsv(kind: "expenses" | "revenue", year: number): Promise<string> {
  await requireStaff(CAN.finance);
  const from = new Date(year, 0, 1);
  const to = new Date(year + 1, 0, 1);
  if (kind === "expenses") {
    const rows = await db.select().from(expenses).where(and(gte(expenses.date, from), lt(expenses.date, to))).orderBy(expenses.date);
    return [
      "date,vendor,category,description,net_eur,vat_rate,vat_eur,gross_eur,status,receipt",
      ...rows.map((r) =>
        [r.date.toISOString().slice(0, 10), esc(r.vendor), esc(r.category), esc(r.description), eur(r.amountNet), r.vatRate, eur(r.vatAmount), eur(r.amountNet + r.vatAmount), r.status, esc(r.receiptUrl)].join(","),
      ),
    ].join("\n");
  }
  const rows = await db
    .select({ inv: invoices, customer: billingCustomers.name, vat: billingCustomers.vatNumber })
    .from(invoices)
    .innerJoin(billingCustomers, eq(billingCustomers.id, invoices.customerId))
    .where(and(gte(invoices.createdAt, from), lt(invoices.createdAt, to)))
    .orderBy(desc(invoices.createdAt));
  return [
    "date,number,customer,customer_vat,description,status,net_eur,vat_eur,total_eur,paid_eur",
    ...rows.map(({ inv, customer, vat }) =>
      [
        inv.createdAt.toISOString().slice(0, 10),
        esc(inv.number),
        esc(customer),
        esc(vat),
        esc(inv.description),
        inv.status,
        eur(inv.amountDue - inv.taxAmount),
        eur(inv.taxAmount),
        eur(inv.amountDue),
        eur(inv.amountPaid),
      ].join(","),
    ),
  ].join("\n");
}
