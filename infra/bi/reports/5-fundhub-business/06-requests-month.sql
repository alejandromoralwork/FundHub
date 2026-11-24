-- name: Requests per month by type
-- display: bar
-- size: 12x6
-- x: month, request_type
-- y: requests
-- stacked: true
select date_trunc('month', created_at)::date as month, request_type, count(*) as requests
from rfi_requests where created_at > now() - interval '12 months'
group by 1, 2 order by 1, 2
