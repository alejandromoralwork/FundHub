-- name: Records per source (linked vs not linked)
-- display: bar
-- size: 12x6
-- x: source
-- y: linked, not_linked
-- stacked: true
select source, linked, records - linked as not_linked
from mart.coverage_by_source
where records > 0
order by records desc
