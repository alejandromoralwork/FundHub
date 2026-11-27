-- name: Latest manager changes
-- display: table
-- size: 24x8
select e.event_date, f.canonical_name as fund, f.fund_regime, f.fund_law, coalesce(c.canonical_name, e.evidence) as new_manager, e.evidence
from core.fund_events e
join core.companies f on f.id = e.company_id
left join core.companies c on c.id = e.related_company_id
where e.kind = 'manager_changed'
order by e.event_date desc
limit 100
