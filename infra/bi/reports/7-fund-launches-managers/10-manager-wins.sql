-- name: Managers winning funds (manager changes, 12 months)
-- display: row
-- size: 12x8
-- x: manager
-- y: funds_won
select coalesce(c.canonical_name, split_part(e.evidence, ' (', 1)) as manager, count(*) as funds_won
from core.fund_events e left join core.companies c on c.id = e.related_company_id
where e.kind = 'manager_changed' and e.event_date >= current_date - interval '12 months'
group by 1 order by 2 desc limit 20
