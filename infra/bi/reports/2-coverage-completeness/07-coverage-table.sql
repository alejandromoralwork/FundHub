-- name: Coverage by source
-- display: table
-- size: 12x6
select name, source, kind, enabled, records, found, gone, linked, pending_review, last_seen_at, last_run_at
from mart.coverage_by_source
