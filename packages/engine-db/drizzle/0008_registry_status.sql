-- 0008 registry_status: RCS / LBR decides whether a company exists; CSSF ranks above GLEIF on conflicts.
--   * core.companies.registry_status (verified | pending | rcs_not_found | compartment | unregistered),
--     recomputed with the golden record by core/registry.ts registryStatus(); backfilled below with the same rule.
--   * raw.documents.rcs_number: the company a filing PDF was sent for (cross-check + linking without filing no.).
--   * ops.attribute_precedence: cssf before gleif for legalForm, status, rcsNumber, website (lei stays gleif first).
-- Additive only: no rows are deleted. ROLLBACK (manual):
--   ALTER TABLE core.companies DROP CONSTRAINT companies_registry_status_check;
--   DROP INDEX core.companies_registry_status_idx;
--   ALTER TABLE core.companies DROP COLUMN registry_status;
--   ALTER TABLE raw.documents DROP COLUMN rcs_number;
--   then re-run the precedence UPDATE below with 'cssf' and 'gleif' swapped in the WHERE (c.rank < g.rank),
--   and the "consolidate" job (or maintenance recompute) to rebuild golden values.
ALTER TABLE "raw"."documents" ADD COLUMN "rcs_number" text;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "registry_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
CREATE INDEX "companies_registry_status_idx" ON "core"."companies" USING btree ("registry_status");--> statement-breakpoint
ALTER TABLE "core"."companies" ADD CONSTRAINT "companies_registry_status_check" CHECK (registry_status in ('verified', 'pending', 'rcs_not_found', 'compartment', 'unregistered'));--> statement-breakpoint

-- RCS > CSSF > GLEIF: swap the two ranks where GLEIF is still ahead of CSSF (idempotent; console edits that
-- already put CSSF first are left alone).
UPDATE ops.attribute_precedence p
SET rank = CASE p.source WHEN 'cssf' THEN x.gleif_rank ELSE x.cssf_rank END
FROM (
  SELECT g.attribute, g.rank AS gleif_rank, c.rank AS cssf_rank
  FROM ops.attribute_precedence g
  JOIN ops.attribute_precedence c ON c.attribute = g.attribute AND c.source = 'cssf'
  WHERE g.source = 'gleif' AND g.attribute IN ('legalForm', 'status', 'rcsNumber', 'website') AND g.rank < c.rank
) x
WHERE p.attribute = x.attribute AND p.source IN ('cssf', 'gleif');
--> statement-breakpoint

-- One-off backfill (same rule as core/registry.ts). Row history is paused: this is a derived flag, and 88k
-- identical "pending → …" history rows would only be noise. Later changes are tracked normally.
ALTER TABLE core.companies DISABLE TRIGGER companies_history;
--> statement-breakpoint
UPDATE core.companies e
SET registry_status = CASE
  WHEN EXISTS (SELECT 1 FROM staging.source_records s WHERE s.company_id = e.id AND s.source IN ('rcs', 'lbr_bulk') AND s.state = 'found') THEN 'verified'
  WHEN EXISTS (SELECT 1 FROM staging.source_records s WHERE s.company_id = e.id AND s.source IN ('rcs', 'lbr_bulk') AND s.state IN ('not_found', 'gone')) THEN 'rcs_not_found'
  WHEN EXISTS (SELECT 1 FROM core.company_identifiers i WHERE i.company_id = e.id AND i.scheme = 'rcs') THEN 'pending'
  WHEN e.fund_role = 'sub_fund' OR e.legal_vehicle = 'sub_fund'
    OR EXISTS (SELECT 1 FROM core.company_identifiers i WHERE i.company_id = e.id AND i.scheme = 'cssf_compartment') THEN 'compartment'
  ELSE 'unregistered'
END;
--> statement-breakpoint
ALTER TABLE core.companies ENABLE TRIGGER companies_history;
