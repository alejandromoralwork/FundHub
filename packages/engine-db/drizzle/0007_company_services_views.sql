-- Services offered: history on staff edits, and read models (current services per company; domiciliation
-- clients per provider, from core.mandates role domiciliation_agent).

CREATE TRIGGER company_services_history AFTER INSERT OR UPDATE OR DELETE ON core.company_services FOR EACH ROW EXECUTE FUNCTION core.track_row_history();
--> statement-breakpoint

-- Current services of every company with category / service labels (one row per service, best source first).
CREATE OR REPLACE VIEW mart.company_services AS
SELECT DISTINCT ON (s.company_id, s.key)
       s.company_id, c.canonical_name AS company, c.is_service_provider,
       s.key, s.category_id, cat.slug, coalesce(cat.label, s.label) AS service, cat.level,
       parent.label AS category, s.source, s.confidence, s.valid_from
FROM core.company_services s
JOIN core.companies c ON c.id = s.company_id
LEFT JOIN core.activity_categories cat ON cat.id = s.category_id
LEFT JOIN core.activity_categories parent ON parent.id = coalesce(cat.parent_id, cat.id)
WHERE s.valid_to IS NULL
ORDER BY s.company_id, s.key, (s.source = 'manual') DESC, s.confidence DESC;
--> statement-breakpoint

-- Domiciliation clients per provider (current), with the client's profile: the league table of fund admins.
CREATE OR REPLACE VIEW mart.domiciliation_clients AS
SELECT m.provider_company_id, m.provider_name, m.client_company_id, f.canonical_name AS client,
       f.company_kind, f.fund_regime, f.fund_role, f.status, m.valid_from, m.valid_from_precision, m.decided_by, m.confidence
FROM core.mandates m JOIN core.companies f ON f.id = m.client_company_id
WHERE m.role = 'domiciliation_agent' AND m.status = 'current';
