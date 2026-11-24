-- name: Open invoices (EUR due)
-- display: scalar
-- size: 8x3
select coalesce(round(sum(amount_due - amount_paid) / 100.0, 2), 0) as due_eur from invoices where status = 'open'
