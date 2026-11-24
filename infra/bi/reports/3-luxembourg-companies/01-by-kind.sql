-- name: Companies by kind
-- display: pie
-- size: 8x6
-- x: kind
-- y: companies
select coalesce(company_kind, 'unclassified') as kind, count(*) as companies
from core.companies group by 1 order by 2 desc
