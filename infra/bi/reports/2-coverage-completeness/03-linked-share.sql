-- name: Source records linked to a company
-- display: scalar
-- size: 8x3
-- format: percent
select count(*) filter (where company_id is not null)::float / greatest(count(*), 1) as share
from staging.source_records where state = 'found' and source not in ('news', 'manual')
