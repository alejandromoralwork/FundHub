-- name: Mentions waiting for review
-- display: scalar
-- size: 8x3
select count(*) as mentions from core.news_mentions where decision = 'pending'
