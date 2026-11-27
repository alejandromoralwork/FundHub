-- name: Administrators with domiciliation clients
-- display: scalar
-- size: 6x3
select count(distinct provider_company_id) as administrators from mart.domiciliation_clients
