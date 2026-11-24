-- name: Top legal forms
-- display: row
-- size: 8x6
-- x: legal_form
-- y: companies
select coalesce(legal_form, 'unknown') as legal_form, count(*) as companies
from core.companies group by 1 order by 2 desc limit 15
