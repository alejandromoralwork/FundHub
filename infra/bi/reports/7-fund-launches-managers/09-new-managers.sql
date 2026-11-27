-- name: Managers with a first launch in the last 24 months (leads)
-- display: table
-- size: 12x8
select manager, first_launch, launches_12m, funds_total + sub_funds_total as funds_and_sub_funds
from mart.manager_momentum
where manager <> 'unknown' and first_launch >= current_date - interval '24 months'
order by first_launch desc
limit 50
