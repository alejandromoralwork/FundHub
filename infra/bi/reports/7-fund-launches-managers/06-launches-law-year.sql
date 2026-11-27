-- name: Fund launches per year by product law (umbrella / standalone)
-- display: bar
-- size: 12x7
-- x: year, law
-- y: funds
-- stacked: true
select extract(year from launch_date)::int::text as year, coalesce(fund_law, 'unknown / unregulated') as law, count(*) as funds
from mart.fund_launches
where fund_role is distinct from 'sub_fund' and launch_date >= current_date - interval '10 years'
group by 1, 2 order by 1, 2
