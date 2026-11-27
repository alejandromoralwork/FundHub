-- name: Launches per quarter by regime (funds and sub-funds)
-- display: bar
-- size: 24x7
-- x: quarter, regime
-- y: launches
-- stacked: true
select to_char(date_trunc('quarter', launch_date), 'YYYY-"Q"Q') as quarter, coalesce(fund_regime, 'unknown') as regime, count(*) as launches
from mart.fund_launches
where launch_date >= current_date - interval '5 years'
group by 1, 2 order by 1, 2
