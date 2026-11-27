-- name: Latest moves between administrators
-- display: table
-- size: 12x8
select switched_on, client, fund_regime, from_provider, to_provider, decided_by
from mart.mandate_switches
where role = 'domiciliation_agent'
order by switched_on desc nulls last
limit 100
