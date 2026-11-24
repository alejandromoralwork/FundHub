-- name: Active subscriptions
-- display: scalar
-- size: 8x3
select count(*) as subscriptions from subscriptions where status in ('active', 'trialing', 'past_due')
