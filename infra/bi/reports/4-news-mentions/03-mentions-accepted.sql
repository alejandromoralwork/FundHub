-- name: Company mentions (90 days)
-- display: scalar
-- size: 8x3
select count(*) as mentions
from core.news_mentions m join clean.articles a on a.id = m.article_id
where m.decision in ('auto', 'accepted') and a.published_at > now() - interval '90 days'
