-- name: Companies by status
-- display: pie
-- size: 8x6
-- x: status
-- y: companies
select coalesce(status, 'unknown') as status, count(*) as companies
from core.companies group by 1 order by 2 desc
