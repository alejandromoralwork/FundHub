-- name: Active subscriptions by plan
-- display: pie
-- size: 8x6
-- x: tier
-- y: subscriptions
select tier, count(*) as subscriptions from subscriptions
where status in ('active', 'trialing', 'past_due') group by 1 order by 2 desc
