-- name: Data-quality checks (latest)
-- display: table
-- size: 12x7
select distinct on (c.code)
  c.label as check, c.layer,
  case when r.value is null then null when r.denominator > 0 then round((r.value * 100)::numeric, 1) else r.value end as value,
  case when r.denominator > 0 then '%' else 'count' end as unit,
  case r.passed when true then 'pass' when false then 'FAIL' else 'not measured' end as result,
  r.measured_at
from ops.quality_checks c
left join ops.quality_results r on r.check_code = c.code
where c.enabled
order by c.code, r.measured_at desc nulls last
