-- name: News feeds
-- display: table
-- size: 12x7
select name, language, enabled, articles, last_polled_at, last_error
from ops.news_feeds order by name
