-- name: Monthly recurring revenue (EUR)
-- display: scalar
-- size: 8x3
select round(sum(amount / case interval when 'year' then 12.0 when 'quarter' then 3.0 else 1.0 end) / 100.0, 2) as mrr_eur
from subscriptions where status in ('active', 'trialing', 'past_due')
