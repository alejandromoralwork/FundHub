-- name: Websites verified (page states the RCS number)
-- display: scalar
-- size: 8x3
-- format: percent
select count(*) filter (where website_verified_at is not null)::float / greatest(count(*) filter (where website is not null), 1) as share
from core.companies
