-- name: Golden field completeness (% of companies not struck off)
-- display: row
-- size: 12x6
-- x: field
-- y: filled_pct
select attribute as field, round((ratio * 100)::numeric, 1) as filled_pct
from mart.field_completeness
order by ratio desc
