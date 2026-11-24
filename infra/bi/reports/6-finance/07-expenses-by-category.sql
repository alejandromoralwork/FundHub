-- name: Expenses by category (12 months, EUR net)
-- display: row
-- size: 24x6
-- x: category
-- y: spent_eur
select category, round(sum(amount_net) / 100.0, 2) as spent_eur
from expenses where date > now() - interval '12 months'
group by 1 order by 2 desc
