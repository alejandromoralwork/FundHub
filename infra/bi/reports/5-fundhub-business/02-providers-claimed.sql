-- name: Providers claimed by their company
-- display: scalar
-- size: 6x3
select count(distinct provider_id) as providers from provider_claims where status = 'approved'
