-- name: Active service providers with a website
-- display: scalar
-- size: 8x3
-- format: percent
select count(*) filter (where website is not null)::float / greatest(count(*), 1) as share
from core.companies where is_service_provider and status = 'active'
