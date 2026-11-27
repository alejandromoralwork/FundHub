-- name: Manager changes (12 months)
-- display: scalar
-- size: 6x3
select count(*) as changes from core.fund_events where kind = 'manager_changed' and event_date >= current_date - interval '12 months'
