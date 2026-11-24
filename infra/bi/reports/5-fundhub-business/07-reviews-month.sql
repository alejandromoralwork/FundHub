-- name: Client reviews per month by status
-- display: bar
-- size: 12x6
-- x: month, status
-- y: reviews
-- stacked: true
select date_trunc('month', created_at)::date as month, status, count(*) as reviews
from reviews where created_at > now() - interval '12 months'
group by 1, 2 order by 1, 2
