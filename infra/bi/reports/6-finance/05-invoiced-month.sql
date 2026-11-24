-- name: Paid per month (EUR)
-- display: bar
-- size: 16x6
-- x: month
-- y: paid_eur
select date_trunc('month', created_at)::date as month, round(sum(amount_paid) / 100.0, 2) as paid_eur
from invoices where created_at > now() - interval '12 months'
group by 1 order by 1
