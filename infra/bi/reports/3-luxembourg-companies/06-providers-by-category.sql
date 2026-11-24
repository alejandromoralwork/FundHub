-- name: Service providers by category
-- display: row
-- size: 12x6
-- x: category
-- y: companies
select coalesce(category_label, 'not classified') as category, count(*) as companies
from mart.company_profile where is_service_provider
group by 1 order by 2 desc
