-- Service mandates: the overlap guard for exclusive roles, history, and the analytics read models
-- (current mandates, switches, fund launches, manager momentum, graph edges). Drizzle cannot express these.

CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint

-- The real-world period of a mandate as a range (open end = still current), for overlap checks and "as at" joins.
ALTER TABLE core.mandates ADD COLUMN period daterange
  GENERATED ALWAYS AS (daterange(coalesce(valid_from, '0001-01-01'::date), valid_to, '[)')) STORED;
--> statement-breakpoint
-- One depositary / auditor / ManCo… at a time per fund and role: overlapping episodes are refused.
ALTER TABLE core.mandates ADD CONSTRAINT mandates_no_overlap
  EXCLUDE USING gist (client_company_id WITH =, role WITH =, period WITH &&)
  WHERE (exclusive AND status IN ('current', 'ended'));
--> statement-breakpoint
CREATE TRIGGER mandates_history AFTER INSERT OR UPDATE OR DELETE ON core.mandates FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint
CREATE TRIGGER mandate_roles_history AFTER INSERT OR UPDATE OR DELETE ON ops.mandate_roles FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint

-- company_profile again: companies gained columns (a view built with c.* keeps its old column list).
DROP VIEW IF EXISTS mart.company_profile;
--> statement-breakpoint
CREATE VIEW mart.company_profile AS
SELECT
  c.*,
  cat.label AS category_label,
  sub.label AS subcategory_label,
  (SELECT count(*) FROM clean.licences l JOIN staging.source_records r ON r.id = l.source_record_id
     WHERE r.company_id = c.id AND l.end_date IS NULL AND l.kind = 'authorised') AS active_licences,
  (SELECT count(*) FROM clean.filings f JOIN staging.source_records r ON r.id = f.source_record_id WHERE r.company_id = c.id) AS filings,
  (SELECT count(*) FROM core.positions p WHERE p.company_id = c.id AND p.valid_to IS NULL) AS people,
  (SELECT count(*) FROM core.news_mentions m WHERE m.company_id = c.id AND m.decision IN ('auto', 'accepted')) AS news_mentions,
  (SELECT count(*) FROM match.conflicts x WHERE x.company_id = c.id AND x.status = 'open') AS open_conflicts,
  (SELECT g.name FROM core.company_group_members m JOIN core.company_groups g ON g.id = m.group_id
     WHERE m.company_id = c.id AND m.valid_to IS NULL AND g.layer = 'corporate' ORDER BY m.confidence DESC LIMIT 1) AS corporate_group,
  (SELECT g.name FROM core.company_group_members m JOIN core.company_groups g ON g.id = m.group_id
     WHERE m.company_id = c.id AND m.valid_to IS NULL AND g.kind = 'fund_structure' ORDER BY m.confidence DESC LIMIT 1) AS fund_structure,
  (SELECT g.name FROM core.company_group_members m JOIN core.company_groups g ON g.id = m.group_id
     WHERE m.company_id = c.id AND m.valid_to IS NULL AND g.kind = 'fund_platform' ORDER BY m.confidence DESC LIMIT 1) AS fund_platform,
  (SELECT m.provider_name FROM core.mandates m WHERE m.client_company_id = c.id AND m.status = 'current'
     AND m.role IN ('management_company', 'aifm') ORDER BY m.valid_from DESC NULLS LAST LIMIT 1) AS manager
FROM core.companies c
LEFT JOIN core.activity_categories cat ON cat.id = c.activity_category_id
LEFT JOIN core.activity_categories sub ON sub.id = c.activity_subcategory_id;
--> statement-breakpoint

-- Current mandates with names, the provider's group (for league tables) and the fund's profile.
CREATE OR REPLACE VIEW mart.mandates_current AS
SELECT m.id, m.role, r.label AS role_label,
       m.client_company_id, f.canonical_name AS client, f.company_kind AS client_kind, f.fund_regime, f.fund_law, f.fund_role,
       m.provider_company_id, m.provider_name, m.provider_lei,
       (SELECT g.name FROM core.company_group_members gm JOIN core.company_groups g ON g.id = gm.group_id
          WHERE gm.company_id = m.provider_company_id AND gm.valid_to IS NULL AND g.layer IN ('service_provider', 'corporate')
          ORDER BY g.layer = 'service_provider' DESC, gm.confidence DESC LIMIT 1) AS provider_group,
       m.valid_from, m.valid_from_precision, m.decided_by, m.confidence
FROM core.mandates m
JOIN core.companies f ON f.id = m.client_company_id
LEFT JOIN ops.mandate_roles r ON r.code = m.role
WHERE m.status = 'current';
--> statement-breakpoint

-- Every provider switch: consecutive episodes of one fund and role with a different provider.
CREATE OR REPLACE VIEW mart.mandate_switches AS
WITH ordered AS (
  SELECT m.*, lag(m.id) OVER w AS prev_id
  FROM core.mandates m
  WHERE m.status IN ('current', 'ended')
  WINDOW w AS (PARTITION BY m.client_company_id, m.role ORDER BY m.valid_from NULLS FIRST, m.id)
)
SELECT o.client_company_id, f.canonical_name AS client, f.fund_regime, f.fund_law, o.role,
       p.provider_company_id AS from_company_id, p.provider_name AS from_provider,
       o.provider_company_id AS to_company_id, o.provider_name AS to_provider,
       coalesce(o.valid_from, p.valid_to) AS switched_on,
       CASE WHEN o.valid_from IS NOT NULL THEN o.valid_from_precision ELSE coalesce(p.valid_to_precision, 'unknown') END AS precision,
       o.decided_by
FROM ordered o
JOIN core.mandates p ON p.id = o.prev_id
JOIN core.companies f ON f.id = o.client_company_id
WHERE coalesce(o.provider_company_id::text, o.provider_lei, o.provider_name) IS DISTINCT FROM coalesce(p.provider_company_id::text, p.provider_lei, p.provider_name);
--> statement-breakpoint

-- Fund launches per month with the manager at launch time (the manager mandate covering the launch date, else
-- the current one) and the fund's profile. Sub-funds are launches too (the fund_role column tells them apart).
CREATE OR REPLACE VIEW mart.fund_launches AS
SELECT date_trunc('month', c.launch_date)::date AS month, c.launch_date, c.id AS company_id, c.canonical_name AS fund,
       c.fund_regime, c.fund_law, c.legal_vehicle, c.fund_role, c.launch_date_source,
       mg.provider_company_id AS manager_company_id, coalesce(mg.provider_name, 'unknown') AS manager
FROM core.companies c
LEFT JOIN LATERAL (
  SELECT m.provider_company_id, m.provider_name FROM core.mandates m
  WHERE m.client_company_id = c.id AND m.role IN ('management_company', 'aifm') AND m.status IN ('current', 'ended')
  ORDER BY (m.period @> c.launch_date) DESC, m.status = 'current' DESC, m.valid_from DESC NULLS LAST
  LIMIT 1
) mg ON true
WHERE c.company_kind = 'fund' AND c.launch_date IS NOT NULL;
--> statement-breakpoint

-- Per manager: funds launched in the last 12 months vs the 12 before, total funds, first and last launch.
CREATE OR REPLACE VIEW mart.manager_momentum AS
SELECT manager, manager_company_id,
       count(*) FILTER (WHERE launch_date >= current_date - interval '12 months') AS launches_12m,
       count(*) FILTER (WHERE launch_date >= current_date - interval '24 months' AND launch_date < current_date - interval '12 months') AS launches_prev_12m,
       count(*) FILTER (WHERE fund_role IS DISTINCT FROM 'sub_fund') AS funds_total,
       count(*) FILTER (WHERE fund_role = 'sub_fund') AS sub_funds_total,
       min(launch_date) AS first_launch, max(launch_date) AS last_launch
FROM mart.fund_launches
GROUP BY manager, manager_company_id;
--> statement-breakpoint

-- One generic edge list for node diagrams: fund ↔ provider mandates, company ↔ group memberships, group nesting.
CREATE OR REPLACE VIEW mart.graph_edges AS
SELECT 'company'::text AS from_type, m.client_company_id::text AS from_id, 'company'::text AS to_type,
       coalesce(m.provider_company_id::text, 'lei:' || m.provider_lei, 'name:' || m.provider_name) AS to_id,
       'mandate:' || m.role AS edge_type, m.valid_from, m.valid_to, m.status::text AS status
FROM core.mandates m
UNION ALL
SELECT 'company', gm.company_id::text, 'group', gm.group_id::text, 'member:' || gm.role, gm.valid_from::date, gm.valid_to::date,
       CASE WHEN gm.valid_to IS NULL THEN 'current' ELSE 'ended' END
FROM core.company_group_members gm
UNION ALL
SELECT 'group', g.id::text, 'group', g.parent_group_id::text, 'child_of', NULL, NULL, 'current'
FROM core.company_groups g WHERE g.parent_group_id IS NOT NULL;
