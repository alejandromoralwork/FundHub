import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@fundhub/db/client";

/**
 * Management finance: revenue from the Stripe mirror (paid invoices), costs from `expenses`.
 * All amounts in cents. Revenue is shown net of VAT (amount paid minus invoice tax).
 */
export async function getFinanceSummary(year: number) {
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
    db.execute<{ month: string; category: string; amount: number }>(sql`
      select month, category, amount from budgets where month like ${`${year}-%`}`),
    db.execute<{ mrr: number; outstanding: number }>(sql`
      select
        (select coalesce(sum(case interval when 'quarter' then amount / 3 when 'year' then amount / 12 else amount end), 0)
           from subscriptions where status in ('active', 'trialing', 'past_due'))::int as mrr,
        (select coalesce(sum(amount_due - amount_paid), 0) from invoices where status = 'open')::int as outstanding`),
  ]);
  return {
    monthly: monthly.rows.map((r) => ({ ...r, revenue: Number(r.revenue), costs: Number(r.costs), profit: Number(r.revenue) - Number(r.costs) })),
    byCategory: byCategory.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    vat: vat.rows.map((r) => ({ ...r, output_vat: Number(r.output_vat), input_vat: Number(r.input_vat), payable: Number(r.output_vat) - Number(r.input_vat) })),
    budgets: budgetRows.rows.map((r) => ({ ...r, amount: Number(r.amount) })),
    mrr: Number(totals.rows[0]?.mrr ?? 0),
    outstanding: Number(totals.rows[0]?.outstanding ?? 0),
  };
}
