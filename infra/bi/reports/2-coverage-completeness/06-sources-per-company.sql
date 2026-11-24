-- name: Companies by number of sources stating them
-- display: bar
-- size: 12x6
-- x: sources
-- y: companies
select source_count::text || case when source_count = 1 then ' source' else ' sources' end as sources, count(*) as companies
from core.companies
group by source_count
order by source_count
