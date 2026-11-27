-- name: Funds and sub-funds by legal vehicle / role
-- display: row
-- size: 12x6
-- x: vehicle
-- y: companies
select coalesce(case when fund_role = 'sub_fund' then 'sub-fund' else legal_vehicle end, 'unknown') as vehicle, count(*) as companies
from core.companies where company_kind = 'fund'
group by 1 order by 2 desc
