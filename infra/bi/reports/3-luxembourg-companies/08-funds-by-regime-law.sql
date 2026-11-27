-- name: Funds by regime and law
-- display: bar
-- size: 12x6
-- x: law, regime
-- y: funds
-- stacked: true
select coalesce(fund_law, 'unknown') as law, coalesce(fund_regime, 'unknown') as regime, count(*) as funds
from core.companies
where company_kind = 'fund' and coalesce(fund_role, '') <> 'sub_fund'
group by 1, 2 order by 3 desc
