-- name: Funds launched (12 months)
-- display: scalar
-- size: 6x3
select count(*) as funds from mart.fund_launches where launch_date >= current_date - interval '12 months' and fund_role is distinct from 'sub_fund'
