-- name: Failed runs (7 days)
-- display: table
-- size: 12x7
select started_at, source, job, left(error, 300) as error
from ops.runs
where status = 'failed' and started_at > now() - interval '7 days'
order by started_at desc
limit 100
