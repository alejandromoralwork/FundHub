-- name: Expenses vs budget by month (EUR, net)
-- display: bar
-- size: 24x7
-- x: month
-- y: spent_eur, budget_eur
with spent as (
  select to_char(date, 'YYYY-MM') as month, sum(amount_net) as cents from expenses
  where date > now() - interval '12 months' group by 1
), budget as (
  select month, sum(amount) as cents from budgets group by 1
)
select coalesce(s.month, b.month) as month,
       round(coalesce(s.cents, 0) / 100.0, 2) as spent_eur,
       round(coalesce(b.cents, 0) / 100.0, 2) as budget_eur
from spent s full join budget b on b.month = s.month
where coalesce(s.month, b.month) >= to_char(now() - interval '12 months', 'YYYY-MM')
order by 1
