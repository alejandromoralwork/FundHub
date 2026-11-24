-- name: Registrations per year
-- display: line
-- size: 12x6
-- x: year
-- y: companies
select extract(year from registration_date)::int::text as year, count(*) as companies
from core.companies where registration_date is not null
group by 1 order by 1
