/**
 * FILE: services/engine/src/pipeline/publish.ts
 * PART: scraping engine (services/engine) — pipeline stage "publish" (Intelligence DB → Website DB)
 * WHAT IT DOES: For every company linked to a FundHub listing (core.companies.website_provider_id), compares
 *   the golden record with the live `providers` row and, where they differ, writes ONE pending proposal into
 *   the website's `ingest_records` (source "engine"): per field the proposed value, a confidence and the
 *   source URL. Staff then accept field by field in the console (Publish review, /admin/pipeline) — nothing
 *   reaches the website automatically. The website never reads the Intelligence DB; this job only writes the
 *   `ingest_*` tables, with the restricted role WEBSITE_DATABASE_URL_PUBLISH.
 *   Values the provider itself declared (winner = "fundhub") are never proposed back to it.
 *   Only companies LBR / RCS confirms exist are proposed (core/registry.ts validCompanySql).
 * WHERE IT RUNS: engine workers (job `publish_proposals`).
 */

import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { db } from "@fundhub/engine-db/client";
import { validCompanySql } from "@fundhub/engine-db/core/registry";
import { countryName, sameValue } from "../core/normalize";

/** Kind: type alias. One proposed field, as the console's review screen expects it. */
type Proposed = { value: unknown; confidence: number; sourceUrl: string | null };

/** Confidence of a proposal by the source that won the golden field. */
const TRUST: Record<string, number> = { manual: 0.99, rcs: 0.95, lbr_bulk: 0.9, cssf: 0.95, gleif: 0.9, website: 0.75, linkedin: 0.6 };

/** Kind: type alias. Outcome of a publish run. */
export type PublishStats = { companies: number; proposals: number; fields: number; skipped: number };

/**
 * Kind: async function. Writes proposals for linked companies.
 * @param opts.publishUrl  the website DB URL of the publish role.
 * @param opts.dryRun      compute and count, write nothing.
 */
export async function publishProposals(opts: { publishUrl: string | undefined; limit?: number; dryRun?: boolean }): Promise<PublishStats> {
  if (!opts.publishUrl) throw new Error("WEBSITE_DATABASE_URL_PUBLISH is not set: publishing needs the website database (ingest_* tables)");
  const web = new Pool({ connectionString: opts.publishUrl, max: 2 });
  const stats: PublishStats = { companies: 0, proposals: 0, fields: 0, skipped: 0 };
  try {
    const linked = (
      await db.execute<{
        id: string; provider_id: number; description: string | null; registered_address: { raw?: string } | null; rcs_number: string | null; headcount: number | null;
        founded_year: number | null; services: string[]; operating_countries: string[]; website: string | null; lineage: Record<string, { source: string; value: unknown }>;
        lists: Record<string, { value: unknown; source_url: string | null }>;
      }>(sql`
        select c.id, c.website_provider_id as provider_id, c.description, c.registered_address, c.rcs_number, c.headcount, c.founded_year,
               c.services, c.operating_countries, c.website,
               coalesce((select jsonb_object_agg(l.attribute, jsonb_build_object('source', l.source, 'value', l.value)) from core.field_lineage l where l.company_id = c.id), '{}') as lineage,
               coalesce((select jsonb_object_agg(x.attribute, jsonb_build_object('value', x.value, 'source_url', f.url))
                 from clean.claims x join staging.source_records r on r.id = x.source_record_id left join raw.fetches f on f.id = r.latest_fetch_id
                 where x.company_id = c.id and x.valid_to is null and x.source = 'website'
                   and x.attribute in ('assetClasses', 'certifications', 'regulatoryScope', 'techStack', 'claimedLicences')), '{}') as lists
        from core.companies c where c.website_provider_id is not null and ${validCompanySql("c")}
        order by c.last_changed_at desc limit ${opts.limit ?? 5000}`)
    ).rows;

    for (const c of linked) {
      stats.companies++;
      const [p] = (await web.query("select id, description, headquarters, rcs_number, headcount, founded_year, services, footprint, website, asset_classes, certifications, regulatory_scope, tech_stack, licences from providers where id = $1", [c.provider_id])).rows;
      if (!p) {
        stats.skipped++;
        continue;
      }
      const proposed: Record<string, Proposed> = {};
      const offer = (field: string, attribute: string | null, value: unknown, current: unknown, sourceUrl: string | null = null) => {
        if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return;
        const lin = attribute ? c.lineage[attribute] : null;
        if (lin?.source === "fundhub") return;
        const norm = (v: unknown) => (Array.isArray(v) ? [...v].map(String).sort() : typeof v === "string" ? v.trim() : v);
        if (sameValue(norm(value), norm(current))) return;
        proposed[field] = { value, confidence: TRUST[lin?.source ?? "website"] ?? 0.7, sourceUrl };
      };
      offer("description", "description", c.description, p.description);
      offer("headquarters", "address", c.registered_address?.raw ?? null, p.headquarters);
      offer("rcsNumber", "rcsNumber", c.rcs_number, p.rcs_number);
      offer("headcount", "headcount", c.headcount, p.headcount);
      offer("foundedYear", "foundedYear", c.founded_year, p.founded_year);
      offer("services", "services", c.services, p.services);
      offer("footprint", "operatingCountries", c.operating_countries.map(countryName), p.footprint);
      offer("website", "website", c.website, p.website);
      const L = c.lists;
      offer("assetClasses", null, L.assetClasses?.value, p.asset_classes, L.assetClasses?.source_url);
      offer("certifications", null, L.certifications?.value, p.certifications, L.certifications?.source_url);
      offer("regulatoryScope", null, L.regulatoryScope?.value, p.regulatory_scope, L.regulatoryScope?.source_url);
      offer("techStack", null, L.techStack?.value, p.tech_stack, L.techStack?.source_url);
      offer("licences", null, L.claimedLicences?.value, p.licences, L.claimedLicences?.source_url);
      if (!Object.keys(proposed).length) continue;

      // One pending engine proposal per provider: an identical one is left alone, an older one is replaced.
      const [pending] = (await web.query("select id, extracted from ingest_records where provider_id = $1 and source = 'engine' and status = 'pending'", [c.provider_id])).rows;
      if (pending && sameValue(pending.extracted, proposed)) continue;
      stats.proposals++;
      stats.fields += Object.keys(proposed).length;
      if (opts.dryRun) continue;
      const values = [`https://fundhub.lu/admin/engine/companies/${c.id}`, JSON.stringify({ companyId: c.id, lineage: c.lineage }), JSON.stringify(proposed)];
      // The publish role may insert and update ingest_* rows, never delete them.
      if (pending) await web.query("update ingest_records set source_url = $2, raw = $3, extracted = $4, created_at = now() where id = $1", [pending.id, ...values]);
      else await web.query("insert into ingest_records (provider_id, source, source_url, raw, extracted) values ($1, 'engine', $2, $3, $4)", [c.provider_id, ...values]);
    }
  } finally {
    await web.end();
  }
  return stats;
}
