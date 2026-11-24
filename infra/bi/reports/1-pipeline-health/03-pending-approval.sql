-- name: Waiting for staging approval
-- display: scalar
-- size: 6x3
select value as records from mart.pipeline_counts where layer = 'staging' and metric = 'pending_review'
