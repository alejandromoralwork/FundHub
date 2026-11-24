-- name: Published providers
-- display: scalar
-- size: 6x3
select count(*) as providers from providers where status = 'published'
