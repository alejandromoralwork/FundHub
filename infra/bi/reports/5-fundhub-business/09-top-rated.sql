-- name: Best rated providers (3+ reviews)
-- display: table
-- size: 24x7
select name, category, provider_type, round(rating::numeric, 2) as rating, review_count, verified, website
from providers
where status = 'published' and review_count >= 3
order by rating desc, review_count desc
limit 50
