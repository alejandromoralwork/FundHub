/**
 * FILE: apps/admin/src/lib/finance.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: Reads all the numbers the Finance page shows for one year: revenue and costs per month,
 *   costs per category, VAT per quarter, budgets, monthly recurring revenue (MRR) and unpaid invoices.
 * WHERE IT RUNS: only on the server (Node.js), because it queries the database directly.
 * FRAMEWORK NOTES: `import "server-only"` is a guard package: if any browser-side code ever imported this
 *   file, the build would fail. That keeps database code and secrets from being bundled into the browser.
 *   Unlike the "*-actions.ts" files, this is not a server action file; it is a plain server helper called
 *   by the Finance page (a server component) while it renders.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async` function returning a Promise; its return type is inferred (worked out by TypeScript).
 *   - generics `db.execute<{ … }>(…)`: the `<…>` tells TypeScript what each result row looks like.
 *   - tagged template strings `` sql`…${value}…` ``: Drizzle turns `${value}` into safe SQL parameters.
 *   - array destructuring, `Promise.all`, `.map`, spread `{ ...r }`, `?.` and `??`.
 */

// Side-effect import: loading it is the check itself (see FRAMEWORK NOTES above). Nothing is named.
import "server-only";
// `import { a } from "b"` brings a named export in from another module.
// `sql` (from the Drizzle ORM npm library) lets us write raw SQL safely: values put inside `${…}` are sent
// separately from the SQL text, so they cannot inject SQL commands.
import { sql } from "drizzle-orm";
// The shared database connection from our own package packages/db.
import { db } from "@fundhub/db/client";

/**
 * Kind: async function.
 * Management finance: revenue from the Stripe mirror (paid invoices), costs from `expenses`.
 * All amounts in cents. Revenue is shown net of VAT (amount paid minus invoice tax).
 * @param year  `number` — the calendar year to report on, e.g. 2026.
 * @returns     `Promise<{ monthly, byCategory, vat, budgets, mrr, outstanding }>` — an object of ready-to-chart
 *              arrays and two totals (TypeScript infers the exact type from the `return` below).
 */
export async function getFinanceSummary(year: number) {
  // Five independent SQL queries run in parallel with `Promise.all`; their results are destructured in order.
  // Each `db.execute<RowType>(sql`…`)` returns `{ rows: RowType[] }`.
  //
  // 1. `monthly`: one row per month of the year. The SQL first builds a list of all 12 months
  //    (`generate_series`, so months with no data still appear), then sums paid invoice revenue (net of tax)
  //    and expense costs per month, and joins them; `coalesce(x, 0)` turns "no data" into 0.
  //    Note: revenue is counted by the invoice's `updated_at`, i.e. roughly when it was marked paid.
  // 2. `byCategory`: total net costs per expense category, biggest first.
  // 3. `vat`: per quarter Q1–Q4, the VAT charged to customers ("output VAT") and the VAT paid on expenses
  //    ("input VAT"). The difference is what is owed to the tax office.
  // 4. `budgetRows`: every budget whose month starts with the year, e.g. "2026-%" (`like` = SQL pattern match).
  // 5. `totals`: MRR = active/trialing/past-due subscriptions converted to a per-month amount (quarterly ÷ 3,
  //    yearly ÷ 12), and `outstanding` = what open invoices still owe.
  // `::int` in SQL casts the sum to a whole number.
  const [monthly, byCategory, vat, budgetRows, totals] = await Promise.all([
    db.execute<{ month: string; revenue: number; costs: number }>(sql`
      with months as (
        select to_char(m, 'YYYY-MM') as month
        from generate_series(make_date(${year}, 1, 1), make_date(${year}, 12, 1), interval '1 month') m
      ),
      rev as (
        select to_char(updated_at, 'YYYY-MM') as month, sum(amount_paid - tax_amount)::int as revenue
        from invoices where status = 'paid' and extract(year from updated_at) = ${year} group by 1
      ),
      cost as (
        select to_char(date, 'YYYY-MM') as month, sum(amount_net)::int as costs
        from expenses where extract(year from date) = ${year} group by 1
      )
      select months.month, coalesce(rev.revenue, 0) as revenue, coalesce(cost.costs, 0) as costs
      from months left join rev using (month) left join cost using (month)
      order by months.month`),
    db.execute<{ category: string; amount: number }>(sql`
      select category, sum(amount_net)::int as amount from expenses
      where extract(year from date) = ${year} group by category order by amount desc`),
    db.execute<{ quarter: string; output_vat: number; input_vat: number }>(sql`
      with q as (select generate_series(1, 4) as n),
      outv as (
        select extract(quarter from updated_at)::int as n, sum(tax_amount)::int as v
        from invoices where status = 'paid' and extract(year from updated_at) = ${year} group by 1
      ),
      inv as (
        select extract(quarter from date)::int as n, sum(vat_amount)::int as v
        from expenses where extract(year from date) = ${year} group by 1
      )
      select 'Q' || q.n as quarter, coalesce(outv.v, 0) as output_vat, coalesce(inv.v, 0) as input_vat
      from q left join outv using (n) left join inv using (n) order by q.n`),
    // The pattern text is built with a normal template string, e.g. "2026-%", and passed as a safe parameter.
    db.execute<{ month: string; category: string; amount: number }>(sql`
      select month, category, amount from budgets where month like ${`${year}-%`}`),
    db.execute<{ mrr: number; outstanding: number }>(sql`
      select
        (select coalesce(sum(case interval when 'quarter' then amount / 3 when 'year' then amount / 12 else amount end), 0)
           from subscriptions where status in ('active', 'trialing', 'past_due'))::int as mrr,
        (select coalesce(sum(amount_due - amount_paid), 0) from invoices where status = 'open')::int as outstanding`),
  ]);
  // Shape the results for the page. Postgres can return big sums as text, so every amount is passed through
  // `Number(…)` to make sure it is a real number. `{ ...r, x: … }` copies the row and overrides/adds fields.
  return {
    // Adds `profit` = revenue − costs for each month.
    monthly: monthly.rows.map((r) => ({ ...r, revenue: Number(r.revenue), costs: Number(r.costs), profit: Number(r.revenue) - Number(r.costs) })),
    byCategory: byCategory.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    // Adds `payable` = output VAT − input VAT (negative means a refund is due).
    vat: vat.rows.map((r) => ({ ...r, output_vat: Number(r.output_vat), input_vat: Number(r.input_vat), payable: Number(r.output_vat) - Number(r.input_vat) })),
    budgets: budgetRows.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    // `rows[0]?.mrr ?? 0`: the first row's value if there is one, otherwise 0.
    mrr: Number(totals.rows[0]?.mrr ?? 0),
    outstanding: Number(totals.rows[0]?.outstanding ?? 0),
  };
}
