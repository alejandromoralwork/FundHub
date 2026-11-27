-- name: Clients that changed administrator (12 months)
-- display: scalar
-- size: 6x3
select count(*) as moves from mart.mandate_switches where role = 'domiciliation_agent' and switched_on >= current_date - interval '12 months'
