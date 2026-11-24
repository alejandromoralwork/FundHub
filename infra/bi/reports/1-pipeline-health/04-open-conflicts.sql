-- name: Open conflicts between sources
-- display: scalar
-- size: 6x3
select value as conflicts from mart.pipeline_counts where layer = 'match' and metric = 'conflicts_open'
