-- name: Approved client reviews
-- display: scalar
-- size: 6x3
select count(*) as reviews from reviews where status = 'approved'
