-- name: Share of active funds domiciled at an administrator
-- display: scalar
-- size: 6x3
-- format: percent
select (select count(*) from mart.domiciliation_clients where company_kind = 'fund')::float
       / greatest((select count(*) from core.companies where company_kind = 'fund' and status <> 'struck_off' and coalesce(fund_role, '') <> 'sub_fund'), 1) as share
