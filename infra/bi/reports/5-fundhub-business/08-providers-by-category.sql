-- name: Published providers by category
-- display: row
-- size: 12x6
-- x: category
-- y: providers
select category, count(*) as providers from providers where status = 'published'
group by 1 order by 2 desc
