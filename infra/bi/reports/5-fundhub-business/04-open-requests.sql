-- name: Open requests
-- display: scalar
-- size: 6x3
select count(*) as requests from rfi_requests where status in ('open', 'in_progress')
