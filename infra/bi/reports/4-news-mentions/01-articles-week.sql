-- name: Articles per week by feed (12 weeks)
-- display: bar
-- size: 16x6
-- x: week, feed
-- y: articles
-- stacked: true
select date_trunc('week', a.published_at)::date as week, coalesce(f.name, 'News search') as feed, count(*) as articles
from clean.articles a left join ops.news_feeds f on f.id = a.feed_id
where a.published_at > now() - interval '12 weeks'
group by 1, 2 order by 1, 2
