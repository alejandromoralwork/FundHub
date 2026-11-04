/**
 * FILE: apps/admin/src/app/(console)/finance/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Finance" page for one calendar year (chosen with ?year=2025 in the URL, default this
 *   year). It loads the year's financial summary and every expense dated in that year, and shows them with
 *   a link to the Finance folder on the company's Nextcloud drive if one is configured.
 * WHERE IT RUNS: on the server (Node.js), as a server component reading the database; FinanceView runs in
 *   the browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/finance = the URL /admin/finance. Next.js passes the URL's query
 *   string (the part after "?") to the page as `searchParams`, e.g. { year: "2025" }.
 * TYPESCRIPT YOU WILL SEE HERE: optional properties (`year?: string`), destructured parameters, `||` as a
 *   fallback, `Date`, `Promise.all`, template strings `` `${x}/…` ``, regular expressions `/\/$/`,
 *   ternaries, `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM helpers: `and` (both conditions), `desc` (sort descending), `gte` (>=), `lt` (<).
import { and, desc, gte, lt } from "drizzle-orm";
// `@fundhub/…` = our shared packages. Database connection and the expenses table.
import { db } from "@fundhub/db/client";
import { expenses } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The finance screen and the type of one expense row.
import { FinanceView, type ExpenseRow } from "@/components/finance-view";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";
// Calculates the year's totals (income, costs, etc.).
import { getFinanceSummary } from "@/lib/finance";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Finance" };

/**
 * Kind: React component (async server component) — the page.
 * @param props  `{ searchParams }` destructured; a Promise of `{ year?: string }` — the `?` means `year` may
 *               be absent from the URL.
 * @returns `Promise<JSX>`: the finance screen markup.
 */
export default async function FinancePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  // Owner only (CAN.finance).
  await requireStaff(CAN.finance);
  // Turn ?year=… into a number. If it is missing or not a number, Number(...) gives NaN or 0, both "falsy",
  // so `||` falls back to the current year (`new Date().getFullYear()`).
  const y = Number((await searchParams).year) || new Date().getFullYear();
  // Run two things at once and name the results.
  const [summary, rows] = await Promise.all([
    getFinanceSummary(y),
    // Every expense from 1 January of year y (inclusive) up to 1 January of the next year (exclusive).
    // `new Date(y, 0, 1)`: months count from 0 in JavaScript, so 0 = January.
    db
      .select()
      .from(expenses)
      .where(and(gte(expenses.date, new Date(y, 0, 1)), lt(expenses.date, new Date(y + 1, 0, 1))))
      .orderBy(desc(expenses.date)),
  ]);
  // driveUrl: if NEXTCLOUD_URL is set, build a link to its /Finance folder; otherwise null (no link).
  // `.replace(/\/$/, "")` removes one trailing "/" (the pattern /\/$/ means "a slash at the very end"), so we
  // never get "//" when joining. The backtick string `` `${a}/apps/…` `` inserts values into text.
  return (
    <FinanceView
      year={y}
      summary={summary}
      expenseRows={JSON.parse(JSON.stringify(rows)) as ExpenseRow[]}
      driveUrl={process.env.NEXTCLOUD_URL ? `${process.env.NEXTCLOUD_URL.replace(/\/$/, "")}/apps/files/?dir=/Finance` : null}
    />
  );
}
