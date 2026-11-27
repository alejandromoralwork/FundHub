-- name: Largest fund platforms (funds per manager)
-- display: table
-- size: 12x7
select g.name as manager, g.head_country as country, g.member_count - 1 as funds_managed,
       (select count(*) from core.company_groups s where s.parent_group_id = g.id) as fund_structures,
       (select p.name from core.company_groups p where p.id = g.parent_group_id) as corporate_group
from core.company_groups g
where g.kind = 'fund_platform'
order by g.member_count desc limit 50
