-- name: Latest articles
-- display: table
-- size: 24x8
select a.published_at, coalesce(f.name, 'News search') as feed, a.title, a.url,
       (select string_agg(c.canonical_name, ', ') from core.news_mentions m join core.companies c on c.id = m.company_id
         where m.article_id = a.id and m.decision in ('auto', 'accepted')) as companies
from clean.articles a left join ops.news_feeds f on f.id = a.feed_id
order by a.published_at desc nulls last
limit 100
