-- name: Most mentioned companies (90 days)
-- display: row
-- size: 12x7
-- x: company
-- y: articles
select c.canonical_name as company, count(distinct m.article_id) as articles
from core.news_mentions m
join core.companies c on c.id = m.company_id
join clean.articles a on a.id = m.article_id
where m.decision in ('auto', 'accepted') and a.published_at > now() - interval '90 days'
group by 1 order by 2 desc limit 20
