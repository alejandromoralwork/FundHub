-- name: Job runs per day (30 days)
-- display: bar
-- size: 16x6
-- x: day, status
-- y: runs
-- stacked: true
select date_trunc('day', started_at)::date as day, status, count(*) as runs
from ops.runs
where started_at > now() - interval '30 days'
group by 1, 2
order by 1, 2
