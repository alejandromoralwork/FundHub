-- name: Domiciliation league table (current clients)
-- display: table
-- size: 14x9
select provider_name as administrator,
       count(*) as clients,
       count(*) filter (where company_kind = 'fund') as funds,
       count(*) filter (where company_kind = 'fund_vehicle') as gps_spvs,
       count(*) filter (where company_kind not in ('fund', 'fund_vehicle')) as other_entities,
       count(*) filter (where fund_regime = 'ucits') as ucits,
       count(*) filter (where fund_regime = 'aif') as aif
from mart.domiciliation_clients
group by provider_company_id, provider_name
order by clients desc
limit 50
