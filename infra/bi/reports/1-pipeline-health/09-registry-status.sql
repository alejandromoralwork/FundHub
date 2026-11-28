-- name: Existence in RCS (registry status)
-- display: bar
-- size: 12x6
-- x: registry_status
-- y: companies,cssf_linked
-- description: LBR / RCS decides whether a company exists. verified = found on LBR; pending = RCS number known, not captured yet; compartment = sub-fund (valid via its umbrella); unregistered = no RCS number (needs an LBR name search); rcs_not_found = LBR had no such company.
select e.registry_status,
       count(*) as companies,
       count(*) filter (where exists (select 1 from staging.source_records s where s.company_id = e.id and s.source = 'cssf' and s.state = 'found')) as cssf_linked
from core.companies e
group by e.registry_status
order by array_position(array['verified', 'pending', 'compartment', 'unregistered', 'rcs_not_found'], e.registry_status)
