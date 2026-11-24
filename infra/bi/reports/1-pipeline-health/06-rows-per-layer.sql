-- name: Rows per layer
-- display: table
-- size: 8x6
select layer, metric, value
from mart.pipeline_counts
order by array_position(array['raw','staging','clean','match','core'], layer), metric
