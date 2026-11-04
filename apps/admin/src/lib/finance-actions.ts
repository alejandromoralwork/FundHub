"use server";
/**
 * FILE: apps/admin/src/lib/finance-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The "write" side of the Finance page: save or delete an expense, copy last month's
 *   recurring expenses into this month, set a monthly budget per category, and produce CSV exports
 *   (expenses or revenue for a year) for the accountant.
 * WHERE IT RUNS: only on the server (Node.js). It talks to the database and must never ship to the browser.
 * FRAMEWORK NOTES: the `"use server"` line at the very top turns every exported async function in this file
 *   into a Next.js "server action". A browser component can call such a function as if it were local, but
 *   Next.js actually sends a request to the server, runs the function there, and sends back the result.
 *   Because anyone could send that request, each action re-checks who is calling (`requireStaff`) before
 *   doing anything. `revalidatePath("/finance")` tells Next.js to throw away its cached copy of the Finance
 *   page so the next visit shows the fresh numbers.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `type X = { a?: string }` type aliases; `?` marks an optional property.
 *   - `async`/`await` and `Promise<T>` (a value of type T that arrives later).
 *   - `Record<string, unknown>`: an object with any text keys whose values are not yet known/checked.
 *   - object destructuring with rest `{ id, ...rest } = obj`, and spread `{ ...obj }`.
 *   - union types `"expenses" | "revenue"` (the value must be one of these exact strings).
 *   - arrow functions `(x) => …`, template strings `` `${a}|${b}` ``, `??` and `||` fallbacks.
 */

// `import { a, b } from "x"` pulls named things out of another module so this file can use them.
// Plain names ("drizzle-orm", "zod") are npm libraries; `@fundhub/…` are our own packages in packages/;
// `./audit` is a file next to this one.
// Drizzle ORM query helpers: `and` (SQL AND), `desc` (ORDER BY … DESC), `eq` (=), `gte` (>=), `lt` (<).
import { and, desc, eq, gte, lt } from "drizzle-orm";
// Next.js cache control: marks a page as stale so it is rebuilt with fresh data.
import { revalidatePath } from "next/cache";
// Zod: a library that describes the expected shape of data and checks ("validates") incoming input.
import { z } from "zod";
// The fixed lists of allowed expense categories and statuses, shared with the rest of FundHub.
import { EXPENSE_CATEGORIES, EXPENSE_STATUSES } from "@fundhub/core/enums";
// The shared database connection (Drizzle ORM over Postgres).
import { db } from "@fundhub/db/client";
// Table definitions used here: Stripe customers, budgets, expenses and invoices.
import { billingCustomers, budgets, expenses, invoices } from "@fundhub/db/schema";
// `audit` writes a row to the audit log: who did what, to which record, and when.
import { audit } from "./audit";
// `requireStaff` checks the caller is a logged-in staff member (password + two-factor) with an allowed role;
// `CAN` is the table of which roles may do which kind of action (e.g. `CAN.finance` = owner only).
import { CAN, requireStaff } from "./auth";

/**
 * Kind: type alias (exported so the UI can use it too).
 * The standard answer every action here returns: either `ok` with a success message, or `error` with
 * a message to show the user. Both are optional (`?`), so `{}` would also be valid.
 */
export type ActionResult = { ok?: string; error?: string };

/**
 * Kind: constant (a Zod schema).
 * Describes what a valid expense from the form looks like. `z.object({...})` = an object with these keys;
 * each key says its type and limits. Anything that does not match is rejected before touching the database,
 * because data from the browser can never be trusted.
 */
const expenseSchema = z.object({
  // Present only when editing an existing expense: a whole (`int`), positive number. `.optional()` = may be absent.
  id: z.number().int().positive().optional(),
  // The date as text, e.g. "2026-10-18"; at least 8 characters as a basic sanity check.
  date: z.string().min(8),
  // `.trim()` removes surrounding spaces first; the second argument to `min` is the error message shown.
  vendor: z.string().trim().min(2, "Vendor is required").max(160),
  // `z.enum(list)` = must be exactly one of the values in that list.
  category: z.enum(EXPENSE_CATEGORIES),
  // `.default("")` = if missing, use an empty string instead of failing.
  description: z.string().trim().max(1000).default(""),
  // In euros as typed in the form. `10_000_000` is just 10000000; the underscores only help readability.
  amountNet: z.number().positive("Amount must be positive").max(10_000_000),
  // VAT percentage, e.g. 17 for Luxembourg's standard rate.
  vatRate: z.number().min(0).max(100),
  status: z.enum(EXPENSE_STATUSES).default("recorded"),
  recurring: z.boolean().default(false),
  // A link to the receipt, or `.or(z.literal(""))` = an empty string is accepted too (field left blank).
  receiptUrl: z.string().trim().max(1000).optional().or(z.literal("")),
});

/**
 * Kind: server action (async function).
 * Creates a new expense or updates an existing one (if `id` is given).
 * Amounts arrive in euros from the form and are stored in cents; VAT is computed here.
 * Storing whole cents (integers) avoids rounding errors that decimal numbers cause in computers.
 * @param input  `Record<string, unknown>` — the raw form values; checked by `expenseSchema` before use.
 * @returns      `Promise<ActionResult>` — a success or error message for the form.
 */
export async function saveExpense(input: Record<string, unknown>): Promise<ActionResult> {
  // Security: only the roles in `CAN.finance` may continue; anyone else is redirected away.
  const staff = await requireStaff(CAN.finance);
  // `.safeParse` checks the input without throwing: it returns `{ success: true, data }` or `{ success: false, error }`.
  const parsed = expenseSchema.safeParse(input);
  // `!` = "not". On failure, show the first problem's message; `?.` avoids a crash if there is no issue,
  // and `??` supplies a fallback text when the left side is null/undefined.
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid expense" };
  // Destructuring: pull out four fields by name; `...rest` collects all the other fields into one object.
  const { id, amountNet, date, receiptUrl, ...rest } = parsed.data;
  // Euros to cents, rounded to a whole number (e.g. 12.345 € → 1235).
  const net = Math.round(amountNet * 100);
  // The row to save. `...rest` copies vendor, category, etc.; the lines after it add or override fields.
  const values = {
    ...rest,
    // Turn the date text into a real JavaScript `Date` object for the database.
    date: new Date(date),
    amountNet: net,
    // VAT in cents = net × rate ÷ 100, rounded.
    vatAmount: Math.round((net * rest.vatRate) / 100),
    // `||` picks the right side when the left is "falsy" (here: empty string), so blank becomes `null` (no value).
    receiptUrl: receiptUrl || null,
  };
  if (id) {
    // Editing: SQL "UPDATE expenses SET … WHERE id = :id".
    await db.update(expenses).set(values).where(eq(expenses.id, id));
    // Record who changed what, for accountability.
    await audit(staff, "update", "expenses", id, { vendor: values.vendor, amountNet: net });
  } else {
    // New expense: "INSERT … RETURNING id" gives back the new row's id. `[row]` takes the first (only) result.
    const [row] = await db.insert(expenses).values({ ...values, createdBy: staff.id }).returning({ id: expenses.id });
    await audit(staff, "create", "expenses", row.id, { vendor: values.vendor, amountNet: net });
  }
  // Make the Finance page show the change on its next load.
  revalidatePath("/finance");
  return { ok: "Expense saved." };
}

/**
 * Kind: server action.
 * Permanently removes one expense.
 * @param id  `number` — the expense's database id.
 * @returns   `Promise<ActionResult>` with a success message.
 */
export async function deleteExpense(id: number): Promise<ActionResult> {
  // Permission check first, as in every action (the request could come from anyone).
  const staff = await requireStaff(CAN.finance);
  // SQL "DELETE FROM expenses WHERE id = :id".
  await db.delete(expenses).where(eq(expenses.id, id));
  // Deletions are audited too, so there is a trace of what disappeared and who removed it.
  await audit(staff, "delete", "expenses", id);
  revalidatePath("/finance");
  return { ok: "Expense deleted." };
}

/**
 * Kind: server action.
 * Copies last month's recurring expenses into the current month (skips ones already copied).
 * Saves typing in rent, software subscriptions, etc. every month. Takes no parameters.
 * @returns `Promise<ActionResult>` saying how many were copied.
 */
export async function copyRecurring(): Promise<ActionResult> {
  const staff = await requireStaff(CAN.finance);
  // `new Date()` = right now.
  const now = new Date();
  // First day of this month and of last month. JavaScript months count from 0 (January = 0);
  // `getMonth() - 1` in January gives -1, which `Date` correctly turns into December of the previous year.
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  // `Promise.all([...])` runs both database queries at the same time and waits for both;
  // the results come back in the same order and are destructured into two names.
  const [previous, current] = await Promise.all([
    // Last month's recurring expenses (date >= start of last month AND date < start of this month).
    db.select().from(expenses).where(and(eq(expenses.recurring, true), gte(expenses.date, lastMonth), lt(expenses.date, thisMonth))),
    // This month's recurring expenses, but only the two columns needed to detect duplicates.
    db.select({ vendor: expenses.vendor, category: expenses.category }).from(expenses).where(and(eq(expenses.recurring, true), gte(expenses.date, thisMonth))),
  ]);
  // A `Set` is a collection of unique values with fast "is this in it?" checks. Each key is "vendor|category".
  // `.map` turns every row into such a key string.
  const have = new Set(current.map((c) => `${c.vendor}|${c.category}`));
  // `.filter` keeps only last month's items whose key is NOT already present this month.
  const toCopy = previous.filter((p) => !have.has(`${p.vendor}|${p.category}`));
  // `for (const p of list)` loops over each item in turn.
  for (const p of toCopy) {
    // Same day, one month later. `setMonth` changes the date object in place.
    const date = new Date(p.date);
    date.setMonth(date.getMonth() + 1);
    // Insert a fresh copy with the same amounts; status starts again at "recorded".
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
  // One audit entry for the whole batch; `null` because no single record is affected.
  await audit(staff, "copy-recurring", "expenses", null, { copied: toCopy.length });
  revalidatePath("/finance");
  // Ternary `condition ? a : b`: a count of 0 counts as false, so the "nothing to copy" message is used.
  return { ok: toCopy.length ? `Copied ${toCopy.length} recurring expense(s) into this month.` : "Nothing to copy: this month is up to date." };
}

/**
 * Kind: server action.
 * Sets (or replaces) the budget for one expense category in one month.
 * @param input  `{ month: string; category: string; amount: number }` — the type is written inline here:
 *               month as "YYYY-MM", the category name, and the amount in euros.
 * @returns      `Promise<ActionResult>`.
 */
export async function saveBudget(input: { month: string; category: string; amount: number }): Promise<ActionResult> {
  const staff = await requireStaff(CAN.finance);
  // Even though TypeScript describes `input`, types disappear at run time, so Zod checks the real values.
  // `/^\d{4}-\d{2}$/` is a regular expression: exactly four digits, a dash, two digits (e.g. "2026-10").
  const parsed = z
    .object({ month: z.string().regex(/^\d{4}-\d{2}$/), category: z.enum(EXPENSE_CATEGORIES), amount: z.number().min(0).max(10_000_000) })
    .safeParse(input);
  if (!parsed.success) return { error: "Invalid budget" };
  // Euros to cents, as above.
  const cents = Math.round(parsed.data.amount * 100);
  // An "upsert": insert a new budget row, but if one already exists for the same month + category
  // (`onConflictDoUpdate` on those two columns), just update its amount instead of failing.
  await db
    .insert(budgets)
    .values({ ...parsed.data, amount: cents })
    .onConflictDoUpdate({ target: [budgets.month, budgets.category], set: { amount: cents } });
  await audit(staff, "budget", "budgets", null, { ...parsed.data });
  revalidatePath("/finance");
  return { ok: "Budget saved." };
}

/**
 * Kind: constant holding an arrow function.
 * Formats cents as a euro amount with two decimals, e.g. 123456 → "1234.56" (text).
 */
const eur = (cents: number) => (cents / 100).toFixed(2);
/**
 * Kind: constant holding an arrow function.
 * Makes a value safe for a CSV cell: wraps it in double quotes and doubles any quote inside
 * (the CSV rule), so commas or quotes in a vendor name do not break the columns.
 * `string | null | undefined` = the value may be text or missing; `?? ""` turns missing into empty text.
 * `/"/g` is a regular expression meaning "every double-quote character".
 */
const esc = (v: string | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/**
 * Kind: server action.
 * CSV exports for the accountant (and import into an accounting system later).
 * @param kind  `"expenses" | "revenue"` — which export to produce.
 * @param year  `number` — the calendar year, e.g. 2026.
 * @returns     `Promise<string>` — the full CSV file contents as one piece of text (the UI turns it into a download).
 */
export async function exportCsv(kind: "expenses" | "revenue", year: number): Promise<string> {
  // Read-only, but financial data is sensitive, so the same permission check applies (no audit needed).
  await requireStaff(CAN.finance);
  // From 1 January of the year (inclusive) to 1 January of the next year (exclusive).
  const from = new Date(year, 0, 1);
  const to = new Date(year + 1, 0, 1);
  if (kind === "expenses") {
    // All expenses in the year, oldest first.
    const rows = await db.select().from(expenses).where(and(gte(expenses.date, from), lt(expenses.date, to))).orderBy(expenses.date);
    // Build an array of lines: the header line, then `...` spreads in one line per expense; `.join("\n")`
    // glues them together with line breaks.
    return [
      "date,vendor,category,description,net_eur,vat_rate,vat_eur,gross_eur,status,receipt",
      ...rows.map((r) =>
        // `.toISOString().slice(0, 10)` turns a date into "YYYY-MM-DD"; `.join(",")` makes the comma-separated row.
        // Gross = net + VAT.
        [r.date.toISOString().slice(0, 10), esc(r.vendor), esc(r.category), esc(r.description), eur(r.amountNet), r.vatRate, eur(r.vatAmount), eur(r.amountNet + r.vatAmount), r.status, esc(r.receiptUrl)].join(","),
      ),
    ].join("\n");
  }
  // Otherwise: revenue. Select each invoice plus its customer's name and VAT number.
  // `innerJoin` links each invoice to its customer row (SQL JOIN … ON customers.id = invoices.customer_id).
  const rows = await db
    .select({ inv: invoices, customer: billingCustomers.name, vat: billingCustomers.vatNumber })
    .from(invoices)
    .innerJoin(billingCustomers, eq(billingCustomers.id, invoices.customerId))
    .where(and(gte(invoices.createdAt, from), lt(invoices.createdAt, to)))
    // Newest invoices first.
    .orderBy(desc(invoices.createdAt));
  return [
    "date,number,customer,customer_vat,description,status,net_eur,vat_eur,total_eur,paid_eur",
    // `({ inv, customer, vat }) =>` destructures each result row straight in the function's parameter list.
    ...rows.map(({ inv, customer, vat }) =>
      [
        inv.createdAt.toISOString().slice(0, 10),
        esc(inv.number),
        esc(customer),
        esc(vat),
        esc(inv.description),
        inv.status,
        // Net = total due minus the tax part.
        eur(inv.amountDue - inv.taxAmount),
        eur(inv.taxAmount),
        eur(inv.amountDue),
        eur(inv.amountPaid),
      ].join(","),
    ),
  ].join("\n");
}
