-- name: Cross-checked by 2+ sources
-- display: scalar
-- size: 6x3
select value as companies from mart.pipeline_counts where layer = 'core' and metric = 'multi_source'
