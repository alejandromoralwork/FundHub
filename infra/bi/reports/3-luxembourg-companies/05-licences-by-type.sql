-- name: Companies holding each active CSSF licence
-- display: row
-- size: 12x6
-- x: licence
-- y: companies
select coalesce(label, code, kind) as licence, count(distinct company_id) as companies
from mart.company_licences
where end_date is null
group by 1 order by 2 desc limit 20
