/**
 * FILE: services/engine/src/sources/fundhub/adapter.ts
 * PART: scraping engine (services/engine) — source "fundhub" (self-declared by providers on fundhub.lu)
 * WHAT IT DOES: Reads, through a READ-ONLY role on the website database (WEBSITE_DATABASE_URL_RO):
 *   - every provider listing (what the provider declared, including approved self-edits, which the console
 *     applies to `providers`), with whether an account claimed it and when it last edited itself;
 *   - approved account claims for companies that are NOT listed yet (a provider that signed up and proposed
 *     its company) — the intake of brand-new companies from FundHub accounts.
 *   Each becomes one raw JSON capture → parseFundhub() → the pipeline. The FundHub review policy is
 *   "review_all": a person checks every self-declared change at the staging gate before it counts.
 * WHERE IT RUNS: engine workers (group "web", job `fundhub_sync`). The website never reads the engine DB.
 */

import { Pool } from "pg";
import { normalizeRcs, parseLuAddress } from "../../core/normalize";
import type { ParsedRecord, RawCapture } from "../../core/types";

export const FUNDHUB_PARSER_VERSION = 1;

/** Kind: type alias. One provider listing as read from the website DB. */
export type ProviderRow = {
  id: number;
  slug: string;
  name: string;
  category: string;
  provider_type: string | null;
  headcount: number | null;
  services: string[] | null;
  licences: string[] | null;
  asset_classes: string[] | null;
  certifications: string[] | null;
  regulatory_scope: string[] | null;
  tech_stack: string[] | null;
  footprint: string[] | null;
  top_clients: string[] | null;
  rcs_number: string | null;
  founded_year: number | null;
  headquarters: string | null;
  website: string | null;
  description: string | null;
  verified: boolean;
  status: string;
  claimed: boolean;
  last_self_edit_at: string | null;
  updated_at: string | null;
};
/** Kind: type alias. An approved claim for a company not listed yet. */
export type ClaimRow = { id: number; proposed_name: string; proposed_category: string | null; proposed_website: string | null; reviewed_at: string | null };

/** Kind: type alias. What is stored in raw. */
export type FundhubBundle = { kind: "provider"; provider: ProviderRow } | { kind: "claim"; claim: ClaimRow };

export class FundhubAdapter {
  readonly source = "fundhub" as const;
  readonly parserVersion = FUNDHUB_PARSER_VERSION;
  private pool: Pool | null = null;

  constructor(private readUrl: string | undefined) {}

  private db() {
    if (!this.readUrl) throw new Error("WEBSITE_DATABASE_URL_RO is not set: the FundHub source needs read access to the website database");
    this.pool ??= new Pool({ connectionString: this.readUrl, max: 2 });
    return this.pool;
  }

  /** Kind: async method. Every listing + approved unlisted claims, as raw captures. */
  async listAll(opts: { since?: string; limit?: number } = {}): Promise<RawCapture[]> {
    const db = this.db();
    const providers = (
      await db.query<ProviderRow>(
        `select p.id, p.slug, p.name, p.category, p.provider_type, nullif(p.headcount, 0) as headcount, p.services, p.licences, p.asset_classes,
                p.certifications, p.regulatory_scope, p.tech_stack, p.footprint, p.top_clients, p.rcs_number, p.founded_year,
                p.headquarters, p.website, p.description, p.verified, p.status,
                exists (select 1 from provider_claims c where c.provider_id = p.id and c.status = 'approved') as claimed,
                -- profile_edits is the log of self-edits already applied to the listing (no review status): latest one.
                (select max(e.created_at) from profile_edits e where e.provider_id = p.id) as last_self_edit_at,
                p.provider_updated_at as updated_at
         from providers p
         where ($1::timestamptz is null or greatest(p.provider_updated_at, p.last_verified_at) >= $1::timestamptz)
         order by p.id limit $2`,
        [opts.since ?? null, opts.limit ?? 100_000],
      )
    ).rows;
    const claims = (
      await db.query<ClaimRow>(
        `select id, proposed_name, proposed_category, proposed_website, reviewed_at from provider_claims
         where status = 'approved' and provider_id is null and proposed_name is not null order by id limit $1`,
        [opts.limit ?? 100_000],
      )
    ).rows;
    const raw = (b: FundhubBundle, id: string): RawCapture => ({ source: "fundhub", externalId: id, url: b.kind === "provider" ? `https://fundhub.lu/providers/${b.provider.slug}` : `https://fundhub.lu/admin/claims#${b.claim.id}`, httpStatus: 200, contentType: "application/json", body: Buffer.from(JSON.stringify(b)), ext: "json" });
    return [...providers.map((p) => raw({ kind: "provider", provider: p }, `provider:${p.id}`)), ...claims.map((c) => raw({ kind: "claim", claim: c }, `claim:${c.id}`))];
  }

  parse(raw: RawCapture): ParsedRecord {
    return parseFundhub(raw);
  }

  async fetch(): Promise<RawCapture | null> {
    throw new Error("FundhubAdapter: use listAll()");
  }

  async close() {
    await this.pool?.end();
  }
}

const list = (v: string[] | null | undefined) => (Array.isArray(v) ? v : []);

/** Kind: function. Raw bundle → ParsedRecord (pure). A listing that was removed from the site is "not_found". */
export function parseFundhub(raw: RawCapture): ParsedRecord {
  const b = JSON.parse(raw.body.toString("utf8")) as FundhubBundle;
  if (b.kind === "claim") {
    const c = b.claim;
    return {
      source: "fundhub",
      externalId: raw.externalId,
      state: "found",
      scope: "claim",
      facts: { name: c.proposed_name, website: c.proposed_website, category: c.proposed_category, accountClaimApprovedAt: c.reviewed_at },
      identifiers: [],
      names: [{ name: c.proposed_name, kind: "trade", validFrom: null }],
    };
  }
  const p = b.provider;
  if (p.status !== "published") return { source: "fundhub", externalId: raw.externalId, state: "not_found", scope: p.category, facts: {}, identifiers: [], names: [] };
  const rcs = normalizeRcs(p.rcs_number);
  const hq = p.headquarters && p.headquarters.trim().toLowerCase() !== "luxembourg" ? parseLuAddress(p.headquarters) : null;
  return {
    source: "fundhub",
    externalId: raw.externalId,
    state: "found",
    scope: p.category,
    facts: {
      name: p.name,
      rcsNumber: rcs,
      website: p.website,
      description: p.description || null,
      headcount: p.headcount,
      foundedYear: p.founded_year,
      services: list(p.services),
      operatingCountries: list(p.footprint),
      address: hq,
      // Source-specific (provenance kept; shown on the company page, not golden fields).
      category: p.category,
      providerType: p.provider_type,
      claimedLicences: list(p.licences),
      assetClasses: list(p.asset_classes),
      certifications: list(p.certifications),
      regulatoryScope: list(p.regulatory_scope),
      techStack: list(p.tech_stack),
      listingVerified: p.verified,
      accountClaimed: p.claimed,
      lastSelfEditAt: p.last_self_edit_at,
    },
    identifiers: [{ scheme: "fundhub_provider", value: String(p.id) }, ...(rcs ? [{ scheme: "rcs" as const, value: rcs }] : [])],
    names: [{ name: p.name, kind: "trade", validFrom: null }],
    relations: list(p.top_clients).map((name) => ({ kind: "client" as const, objectName: name, evidenceUrl: raw.url, confidence: 0.8 })),
  };
}
