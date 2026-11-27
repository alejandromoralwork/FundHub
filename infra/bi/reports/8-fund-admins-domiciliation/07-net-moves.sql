-- name: Net client moves per administrator (12 months)
-- display: table
-- size: 12x8
with moves as (
  select from_provider as admin, -1 as d from mart.mandate_switches where role = 'domiciliation_agent' and switched_on >= current_date - interval '12 months'
  union all
  select to_provider, 1 from mart.mandate_switches where role = 'domiciliation_agent' and switched_on >= current_date - interval '12 months'
)
select admin as administrator, count(*) filter (where d = 1) as won, count(*) filter (where d = -1) as lost, sum(d) as net
from moves group by 1 order by net desc, won desc limit 40
