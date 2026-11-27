-- Company groups: history for the hand-maintained parts, the group tree view, and company_profile recreated so it
-- carries the new fund-profile columns (a view built with c.* keeps the column list it had when it was created).

CREATE TRIGGER company_groups_history AFTER INSERT OR UPDATE OR DELETE ON core.company_groups FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint

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
     WHERE m.company_id = c.id AND m.valid_to IS NULL AND g.kind = 'fund_platform' ORDER BY m.confidence DESC LIMIT 1) AS fund_platform
FROM core.companies c
LEFT JOIN core.activity_categories cat ON cat.id = c.activity_category_id
LEFT JOIN core.activity_categories sub ON sub.id = c.activity_subcategory_id;
--> statement-breakpoint

-- Every group with its depth (1 = top), the path of names from the top, and its top-level group.
CREATE OR REPLACE VIEW mart.group_tree AS
WITH RECURSIVE t AS (
  SELECT g.id, g.parent_group_id, g.name, g.layer, g.kind, g.source, g.member_count, g.head_company_id,
         1 AS depth, g.name::text AS path, g.id AS root_id
  FROM core.company_groups g
  WHERE g.parent_group_id IS NULL
  UNION ALL
  SELECT g.id, g.parent_group_id, g.name, g.layer, g.kind, g.source, g.member_count, g.head_company_id,
         t.depth + 1, t.path || ' › ' || g.name, t.root_id
  FROM core.company_groups g JOIN t ON g.parent_group_id = t.id
  WHERE t.depth < 10
)
SELECT * FROM t;
--> statement-breakpoint

-- Current memberships with names, for reports.
CREATE OR REPLACE VIEW mart.group_members AS
SELECT g.id AS group_id, g.name AS group_name, g.layer, g.kind, m.role, m.source, m.confidence, m.evidence,
       c.id AS company_id, c.canonical_name AS company, c.company_kind, c.fund_regime, c.fund_law, c.legal_vehicle, c.fund_role,
       c.rcs_number, c.lei
FROM core.company_group_members m
JOIN core.company_groups g ON g.id = m.group_id
JOIN core.companies c ON c.id = m.company_id
WHERE m.valid_to IS NULL;
