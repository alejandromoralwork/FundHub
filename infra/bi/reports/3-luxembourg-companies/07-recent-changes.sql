-- name: Recently changed companies
-- display: table
-- size: 12x6
select canonical_name as company, rcs_number, lei, status, legal_form, source_count as sources,
       active_licences, news_mentions, open_conflicts, last_changed_at
from mart.company_profile
order by last_changed_at desc nulls last
limit 100
