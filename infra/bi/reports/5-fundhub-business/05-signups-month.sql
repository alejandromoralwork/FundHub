-- name: New accounts per month
-- display: bar
-- size: 12x6
-- x: month, account_type
-- y: accounts
-- stacked: true
select date_trunc('month', created_at)::date as month, account_type, count(*) as accounts
from users where created_at > now() - interval '12 months'
group by 1, 2 order by 1, 2
