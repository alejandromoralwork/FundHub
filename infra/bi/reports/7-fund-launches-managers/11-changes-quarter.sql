-- name: Manager changes per quarter
-- display: line
-- size: 12x8
-- x: quarter
-- y: changes
select to_char(date_trunc('quarter', event_date), 'YYYY-"Q"Q') as quarter, count(*) as changes
from core.fund_events
where kind = 'manager_changed' and event_date >= current_date - interval '4 years'
group by 1 order by 1
