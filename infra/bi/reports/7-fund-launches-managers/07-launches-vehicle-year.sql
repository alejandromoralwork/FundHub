-- name: Fund launches per year by legal vehicle
-- display: bar
-- size: 12x7
-- x: year, vehicle
-- y: funds
-- stacked: true
select extract(year from launch_date)::int::text as year, coalesce(legal_vehicle, 'unknown') as vehicle, count(*) as funds
from mart.fund_launches
where fund_role is distinct from 'sub_fund' and launch_date >= current_date - interval '10 years'
group by 1, 2 order by 1, 2
