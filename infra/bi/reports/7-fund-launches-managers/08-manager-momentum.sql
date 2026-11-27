-- name: Manager momentum (launches, 12 months vs previous 12)
-- display: table
-- size: 12x8
select manager, launches_12m, launches_prev_12m, launches_12m - launches_prev_12m as change,
       funds_total, sub_funds_total, first_launch, last_launch
from mart.manager_momentum
where manager <> 'unknown'
order by launches_12m desc, change desc
limit 50
