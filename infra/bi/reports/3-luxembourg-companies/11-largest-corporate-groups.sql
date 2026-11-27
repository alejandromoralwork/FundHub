-- name: Largest corporate groups in Luxembourg
-- display: table
-- size: 12x7
select g.name as "group", g.head_country as parent_country, g.member_count as luxembourg_entities,
       (select count(*) from core.company_groups s where s.parent_group_id = g.id and s.kind = 'fund_platform') as fund_platforms,
       g.source
from core.company_groups g
where g.kind = 'corporate_group'
order by g.member_count desc limit 50
