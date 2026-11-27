-- name: Domiciled entities by kind
-- display: pie
-- size: 10x9
-- x: kind
-- y: entities
select coalesce(company_kind, 'unknown') as kind, count(*) as entities from mart.domiciliation_clients group by 1 order by 2 desc
