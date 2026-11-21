-- Pipeline SQL that Drizzle cannot express: extensions, the row_history triggers, and the "mart" views
-- (read models for the console and analytics). Views are dropped and recreated, so this file can be edited
-- in later custom migrations by copying the view definitions.

-- Trigram similarity for fuzzy name matching.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

-- core.row_history: trigger function shared by the audited tables. Bookkeeping-only updates (timestamps that
-- move on every unchanged re-fetch) are skipped so the history only holds real changes.
CREATE OR REPLACE FUNCTION core.track_row_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  noise text[] := ARRAY['last_seen_at', 'last_changed_at', 'classified_at', 'updated_at', 'source_count'];
BEGIN
  IF TG_OP = 'UPDATE' AND (o - noise) = (n - noise) THEN
    RETURN NEW;
  END IF;
  INSERT INTO core.row_history (table_name, row_id, op, old_row, new_row, actor)
  VALUES (
    TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME,
    coalesce(n ->> 'id', o ->> 'id', n ->> 'prefix', o ->> 'prefix', n ->> 'key', o ->> 'key', n ->> 'code', o ->> 'code',
             (n ->> 'attribute') || ':' || (n ->> 'source'), (o ->> 'attribute') || ':' || (o ->> 'source')),
    TG_OP, o, n, nullif(current_setting('app.actor', true), ''));
  RETURN coalesce(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER companies_history AFTER INSERT OR UPDATE OR DELETE ON core.companies FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint
CREATE TRIGGER company_relations_history AFTER INSERT OR UPDATE OR DELETE ON core.company_relations FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint
CREATE TRIGGER classification_rules_history AFTER INSERT OR UPDATE OR DELETE ON core.classification_rules FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint
CREATE TRIGGER activity_categories_history AFTER INSERT OR UPDATE OR DELETE ON core.activity_categories FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint
CREATE TRIGGER sources_history AFTER INSERT OR UPDATE OR DELETE ON ops.sources FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint
CREATE TRIGGER attribute_precedence_history AFTER INSERT OR UPDATE OR DELETE ON ops.attribute_precedence FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint
CREATE TRIGGER review_policies_history AFTER INSERT OR UPDATE OR DELETE ON ops.review_policies FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint
CREATE TRIGGER settings_history AFTER INSERT OR UPDATE OR DELETE ON ops.settings FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint
CREATE TRIGGER lbr_number_space_history AFTER INSERT OR UPDATE OR DELETE ON ops.lbr_number_space FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint
CREATE TRIGGER lbr_capture_rounds_history AFTER INSERT OR UPDATE OR DELETE ON ops.lbr_capture_rounds FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS companies_name_trgm_idx ON core.companies USING gin (normalized_name gin_trgm_ops);
--> statement-breakpoint

-- ============================================================ mart: read models
CREATE SCHEMA IF NOT EXISTS mart;
--> statement-breakpoint

-- One row per company with its category labels and cross-source depth.
CREATE OR REPLACE VIEW mart.company_profile AS
SELECT
  c.*,
  cat.label AS category_label,
  sub.label AS subcategory_label,
  (SELECT count(*) FROM clean.licences l JOIN staging.source_records r ON r.id = l.source_record_id
     WHERE r.company_id = c.id AND l.end_date IS NULL AND l.kind = 'authorised') AS active_licences,
  (SELECT count(*) FROM clean.filings f JOIN staging.source_records r ON r.id = f.source_record_id WHERE r.company_id = c.id) AS filings,
  (SELECT count(*) FROM core.positions p WHERE p.company_id = c.id AND p.valid_to IS NULL) AS people,
  (SELECT count(*) FROM core.news_mentions m WHERE m.company_id = c.id AND m.decision IN ('auto', 'accepted')) AS news_mentions,
  (SELECT count(*) FROM match.conflicts x WHERE x.company_id = c.id AND x.status = 'open') AS open_conflicts
FROM core.companies c
LEFT JOIN core.activity_categories cat ON cat.id = c.activity_category_id
LEFT JOIN core.activity_categories sub ON sub.id = c.activity_subcategory_id;
--> statement-breakpoint

-- Licences per company (CSSF lines through the source record link).
CREATE OR REPLACE VIEW mart.company_licences AS
SELECT r.company_id, l.*
FROM clean.licences l JOIN staging.source_records r ON r.id = l.source_record_id
WHERE r.company_id IS NOT NULL;
--> statement-breakpoint

-- Per source: how many records, how many linked to a company, waiting at the gate, last activity.
CREATE OR REPLACE VIEW mart.coverage_by_source AS
SELECT
  s.code AS source, s.system, s.name, s.kind, s.enabled,
  count(r.id) AS records,
  count(r.id) FILTER (WHERE r.state = 'found') AS found,
  count(r.id) FILTER (WHERE r.state = 'gone') AS gone,
  count(r.id) FILTER (WHERE r.company_id IS NOT NULL) AS linked,
  (SELECT count(*) FROM staging.parsed_records p JOIN staging.source_records rr ON rr.id = p.source_record_id
     WHERE rr.source = s.code AND p.review_status = 'pending') AS pending_review,
  max(r.last_seen_at) AS last_seen_at,
  (SELECT max(started_at) FROM ops.runs u WHERE u.source = s.code) AS last_run_at
FROM ops.sources s LEFT JOIN staging.source_records r ON r.source = s.code
GROUP BY s.code, s.system, s.name, s.kind, s.enabled, s.sort
ORDER BY s.sort;
--> statement-breakpoint

-- Share of companies (not struck off) that have each golden field.
CREATE OR REPLACE VIEW mart.field_completeness AS
WITH base AS (SELECT * FROM core.companies WHERE status <> 'struck_off'), n AS (SELECT greatest(count(*), 1)::real AS total FROM base)
SELECT f.attribute, f.filled, (SELECT total FROM n)::int AS total, f.filled / (SELECT total FROM n) AS ratio
FROM (
  SELECT 'rcsNumber' AS attribute, count(*) FILTER (WHERE rcs_number IS NOT NULL) AS filled FROM base
  UNION ALL SELECT 'lei', count(*) FILTER (WHERE lei IS NOT NULL) FROM base
  UNION ALL SELECT 'legalForm', count(*) FILTER (WHERE legal_form IS NOT NULL) FROM base
  UNION ALL SELECT 'address', count(*) FILTER (WHERE registered_address IS NOT NULL) FROM base
  UNION ALL SELECT 'registrationDate', count(*) FILTER (WHERE registration_date IS NOT NULL) FROM base
  UNION ALL SELECT 'website', count(*) FILTER (WHERE website IS NOT NULL) FROM base
  UNION ALL SELECT 'description', count(*) FILTER (WHERE description IS NOT NULL) FROM base
  UNION ALL SELECT 'phone', count(*) FILTER (WHERE phone IS NOT NULL) FROM base
  UNION ALL SELECT 'email', count(*) FILTER (WHERE email IS NOT NULL) FROM base
  UNION ALL SELECT 'headcount', count(*) FILTER (WHERE headcount IS NOT NULL) FROM base
  UNION ALL SELECT 'classified', count(*) FILTER (WHERE classification_source IS NOT NULL) FROM base
) f;
--> statement-breakpoint

-- Row counts per layer, for the console's pipeline diagram.
CREATE OR REPLACE VIEW mart.pipeline_counts AS
SELECT 'raw' AS layer, 'fetches' AS metric, count(*)::bigint AS value FROM raw.fetches
UNION ALL SELECT 'raw', 'documents', count(*) FROM raw.documents
UNION ALL SELECT 'staging', 'source_records', count(*) FROM staging.source_records
UNION ALL SELECT 'staging', 'parsed_records', count(*) FROM staging.parsed_records
UNION ALL SELECT 'staging', 'pending_review', count(*) FROM staging.parsed_records WHERE review_status = 'pending'
UNION ALL SELECT 'staging', 'rejected', count(*) FROM staging.parsed_records WHERE review_status = 'rejected'
UNION ALL SELECT 'clean', 'claims_open', count(*) FROM clean.claims WHERE valid_to IS NULL
UNION ALL SELECT 'clean', 'rejects', count(*) FROM clean.rejects
UNION ALL SELECT 'clean', 'licences', count(*) FROM clean.licences
UNION ALL SELECT 'clean', 'filings', count(*) FROM clean.filings
UNION ALL SELECT 'clean', 'articles', count(*) FROM clean.articles
UNION ALL SELECT 'match', 'candidates_pending', count(*) FROM match.candidates WHERE decision = 'pending'
UNION ALL SELECT 'match', 'conflicts_open', count(*) FROM match.conflicts WHERE status = 'open'
UNION ALL SELECT 'core', 'companies', count(*) FROM core.companies
UNION ALL SELECT 'core', 'service_providers', count(*) FROM core.companies WHERE is_service_provider
UNION ALL SELECT 'core', 'multi_source', count(*) FROM core.companies WHERE source_count >= 2
UNION ALL SELECT 'core', 'people', count(*) FROM core.people
UNION ALL SELECT 'core', 'positions', count(*) FROM core.positions WHERE valid_to IS NULL
UNION ALL SELECT 'core', 'web_presence', count(*) FROM core.web_presence
UNION ALL SELECT 'core', 'news_mentions', count(*) FROM core.news_mentions
UNION ALL SELECT 'core', 'mentions_pending', count(*) FROM core.news_mentions WHERE decision = 'pending'
UNION ALL SELECT 'core', 'relations', count(*) FROM core.company_relations WHERE valid_to IS NULL
UNION ALL SELECT 'core', 'changes_7d', count(*) FROM core.changes WHERE detected_at > now() - interval '7 days'
UNION ALL SELECT 'publish', 'linked_providers', count(*) FROM core.companies WHERE website_provider_id IS NOT NULL;
