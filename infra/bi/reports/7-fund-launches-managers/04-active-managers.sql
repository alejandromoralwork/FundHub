-- name: Managers that launched in 12 months
-- display: scalar
-- size: 6x3
select count(*) as managers from mart.manager_momentum where launches_12m > 0 and manager <> 'unknown'
