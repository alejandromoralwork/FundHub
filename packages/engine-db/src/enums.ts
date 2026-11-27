/**
 * FILE: packages/engine-db/src/enums.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: The fixed lists of allowed words used by the Intelligence database (source codes, pipeline
 *   layers, company kinds, change kinds, review states…). One place, so the schema, the workers and the admin
 *   console agree on the same spelling. Display names and settings of each source live in the `ops.sources`
 *   TABLE (seeded from seed-data.ts); this file only holds the codes.
 * WHERE IT RUNS: anywhere — it is plain data.
 * TYPESCRIPT YOU WILL SEE HERE: `as const` (keep the exact words as types), indexed access types
 *   `(typeof X)[number]` (= "any one item of the list X").
 */

/**
 * Kind: constant. Every source code. A source SYSTEM (LBR, GLEIF…) may have several feeds with their own code:
 * LBR = "rcs" (company pages captured in the browser) + "lbr_bulk" (official extract files). Both key their
 * records on the RCS number, so they must stay separate codes.
 *   rcs · lbr_bulk · gleif · cssf          registers and regulators
 *   fundhub                                 self-declared by providers on fundhub.lu (accounts, claims, edits)
 *   website · news                          the company's own website, newspapers
 *   linkedin · glassdoor · instagram · facebook · x   social / people / reviews (phase 2, disabled)
 *   manual                                  an edit by FundHub staff in the admin console (always wins)
 *   engine                                  inferred by the engine from other data (e.g. domiciliation from a
 *                                           shared registered address); never a primary source of facts
 */
export const ENGINE_SOURCES = [
  "rcs",
  "lbr_bulk",
  "gleif",
  "cssf",
  "fundhub",
  "website",
  "news",
  "linkedin",
  "glassdoor",
  "instagram",
  "facebook",
  "x",
  "manual",
  "engine",
] as const;
export type EngineSource = (typeof ENGINE_SOURCES)[number];

/** Kind: constant. What kind of source it is (drives the diagram grouping and default trust). */
export const SOURCE_KINDS = ["register", "secondary_register", "regulator", "self_declared", "web", "news", "social", "people", "reviews", "staff", "derived"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

/** Kind: constant. How data is acquired from a source. */
export const ACQUISITION_METHODS = ["api", "bulk_file", "browser_capture", "crawl", "rss", "database", "manual"] as const;
export type AcquisitionMethod = (typeof ACQUISITION_METHODS)[number];

/** Kind: constant. The pipeline layers, in order. Each is a Postgres schema of the Intelligence DB. */
export const LAYERS = ["raw", "staging", "clean", "match", "core", "mart", "publish"] as const;
export type Layer = (typeof LAYERS)[number];

/** Kind: constant. What we last learned about an id at its source. */
export const SOURCE_RECORD_STATES = ["found", "not_found", "gone"] as const;
export type SourceRecordState = (typeof SOURCE_RECORD_STATES)[number];

/**
 * Kind: constant. Staging approval gate. "not_required" = flowed straight on; "pending" = held for a person;
 * "approved" / "edited" (approved with corrections) = released downstream; "rejected" = stopped for good;
 * "superseded" = a newer version of the same record arrived while this one was still pending.
 */
export const REVIEW_STATUSES = ["not_required", "pending", "approved", "edited", "rejected", "superseded"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** Kind: constant. Review policy modes: never hold · always hold · hold when a condition matches · random spot checks. */
export const REVIEW_MODES = ["auto", "review_all", "review_if", "sample"] as const;
export type ReviewMode = (typeof REVIEW_MODES)[number];

/** Kind: constant. Life-cycle status of a company (golden record). */
export const COMPANY_STATUSES = ["active", "in_liquidation", "struck_off", "unknown"] as const;
export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

/**
 * Kind: constant. Broad kind of company; finer detail lives in activity category / subcategory and, for the fund
 * world, in the fund profile below. `asset_manager` = ManCos and AIFMs; `fund_vehicle` = a company that exists for
 * a fund structure without being the fund itself (general partner, SPV, fund holding).
 */
export const COMPANY_KINDS = ["service_provider", "asset_manager", "fund", "fund_vehicle", "bank", "financial_institution", "corporate", "other"] as const;
export type CompanyKind = (typeof COMPANY_KINDS)[number];

// ---------------------------------------------------------------- fund profile (core.companies)

/** Kind: constant. EU regime of a fund: UCITS (2010 Law Part I) or AIF (everything else that is a fund). */
export const FUND_REGIMES = ["ucits", "aif", "other"] as const;
export type FundRegime = (typeof FUND_REGIMES)[number];

/** Kind: constant. The Luxembourg product law a fund (or securitisation / pension vehicle) falls under. */
export const FUND_LAWS = ["ucits_part_i", "uci_part_ii", "sif", "sicar", "raif", "securitisation", "pension", "unregulated", "foreign"] as const;
export type FundLaw = (typeof FUND_LAWS)[number];

/** Kind: constant. Legal vehicle (corporate form) — from the RCS / GLEIF legal form, CSSF sub-group or the name suffix. */
export const LEGAL_VEHICLES = ["fcp", "sicav", "sicaf", "scsp", "scs", "sca", "sa", "sarl", "sas", "scoop", "sub_fund", "other"] as const;
export type LegalVehicle = (typeof LEGAL_VEHICLES)[number];

/** Kind: constant. Role of a company inside a fund structure. */
export const FUND_ROLES = ["standalone_fund", "umbrella_fund", "sub_fund", "master_fund", "feeder_fund", "general_partner", "spv", "holding"] as const;
export type FundRole = (typeof FUND_ROLES)[number];

/** Kind: constant. What kind of fund manager (from the CSSF registers). */
export const MANAGER_TYPES = ["super_manco", "ucits_manco", "manco_ch16", "aifm_authorised", "aifm_registered", "aifm_branch", "manco_branch"] as const;
export type ManagerType = (typeof MANAGER_TYPES)[number];

// ---------------------------------------------------------------- time model

/** Kind: constant. How precise a real-world date is ("2019" known only as a year → 2019-01-01 + "year"). */
export const DATE_PRECISIONS = ["day", "month", "year", "unknown"] as const;
export type DatePrecision = (typeof DATE_PRECISIONS)[number];

/** Kind: constant. Where a company sits legally: in the Luxembourg RCS, Luxembourg but not in the RCS (some funds), or abroad. */
export const REGISTER_SCOPES = ["lu_rcs", "lu_unregistered", "foreign"] as const;
export type RegisterScope = (typeof REGISTER_SCOPES)[number];

// ---------------------------------------------------------------- service mandates (core.mandates)

/**
 * Kind: constant. Roles a provider can hold for a fund. The full reference (label, exclusive, regulated) is the
 * seeded table ops.mandate_roles; this list is for validation and types.
 */
export const MANDATE_ROLES = [
  "management_company", "aifm", "investment_manager", "investment_adviser", "depositary", "central_administration",
  "transfer_agent", "registrar", "auditor", "domiciliation_agent", "distributor", "paying_agent", "legal_adviser",
  "prime_broker", "listing_agent", "director", "service_provider",
] as const;
export type MandateRole = (typeof MANDATE_ROLES)[number];

/** Kind: constant. State of a mandate episode. `disputed` = sources disagree, a person should look. */
export const MANDATE_STATUSES = ["current", "ended", "announced", "disputed"] as const;
export type MandateStatus = (typeof MANDATE_STATUSES)[number];

// ---------------------------------------------------------------- fund lifecycle (core.fund_events)

/** Kind: constant. Dated events in a fund's life. */
export const FUND_EVENT_KINDS = [
  "incorporated", "authorised", "launched", "sub_fund_added", "sub_fund_closed", "manager_appointed", "manager_changed",
  "renamed", "merged_into", "redomiciled_in", "redomiciled_out", "in_liquidation", "deregistered", "closed",
] as const;
export type FundEventKind = (typeof FUND_EVENT_KINDS)[number];

// ---------------------------------------------------------------- company groups (core.company_groups)

/** Kind: constant. The three grouping layers: corporate (who owns whom), fund (fund structures), service providers. */
export const GROUP_LAYERS = ["corporate", "fund", "service_provider"] as const;
export type GroupLayer = (typeof GROUP_LAYERS)[number];

/**
 * Kind: constant. Group kinds. Corporate layer: `corporate_group` (an ultimate parent and its subsidiaries).
 * Fund layer: `fund_platform` (one ManCo/AIFM and the funds it manages) → `fund_structure` (one umbrella or
 * standalone fund with its sub-funds, feeders and vehicles). Service-provider layer: `provider_group` (a provider
 * network / brand and its Luxembourg entities).
 */
export const GROUP_KINDS = ["corporate_group", "fund_platform", "fund_structure", "provider_group"] as const;
export type GroupKind = (typeof GROUP_KINDS)[number];

/** Kind: constant. A member's role inside its group. `head` = the company the group is anchored on. */
export const GROUP_ROLES = ["head", "subsidiary", "branch", "managed_fund", "umbrella_fund", "sub_fund", "master_fund", "feeder_fund", "general_partner", "spv", "holding", "member"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

/** Kind: constant. Who made a group or membership. Builders never touch `manual` rows. */
export const GROUP_SOURCES = ["gleif", "cssf", "name_rule", "manual"] as const;
export type GroupSource = (typeof GROUP_SOURCES)[number];

/**
 * Kind: constant. How deep the engine goes for a company:
 * 0 = register metadata only · 1 = + filing PDFs · 2 = + website crawl, news and frequent refresh.
 */
export const TIERS = [0, 1, 2] as const;
export type Tier = (typeof TIERS)[number];

/** Kind: constant. Who decided a company's classification. "manual" is never overwritten by rules. */
export const CLASSIFICATION_SOURCES = ["rule", "ai", "manual"] as const;
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];

/** Kind: constant. Identifier schemes stored in core.company_identifiers. */
/** `cssf_compartment` = a sub-fund code as the CSSF lists it, e.g. "O00012720_00000001". */
export const ID_SCHEMES = ["rcs", "lei", "cssf_code", "cssf_id", "cssf_compartment", "vat", "matricule", "fundhub_provider", "domain"] as const;
export type IdScheme = (typeof ID_SCHEMES)[number];

/** Kind: constant. What a change (core.changes) is about. */
export const CHANGE_KINDS = [
  "new_company",
  "new_record",
  "record_gone",
  "attribute_changed",
  "name_change",
  "status_change",
  "address_change",
  "new_filing",
  "authorisation_added",
  "authorisation_ended",
  "relation_added",
  "relation_ended",
  "position_added",
  "position_ended",
  "news_mention",
  "conflict_detected",
  "companies_merged",
  "mandate_started",
  "mandate_ended",
  "mandate_switched",
] as const;
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/**
 * Kind: constant. What the SUBJECT company (usually a service provider) is to the OBJECT company.
 * "client" = a client named without a specific role (website client lists, case studies).
 */
export const RELATION_KINDS = [
  "client",
  "administrator",
  "transfer_agent",
  "depositary",
  "management_company",
  "domiciliation_agent",
  "auditor",
  "legal_adviser",
  "parent",
  "other",
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

/** Kind: constant. A person's role at a company (core.positions). */
export const POSITION_ROLES = ["board", "executive", "manager", "employee", "authorised_signatory", "auditor", "other"] as const;
export type PositionRole = (typeof POSITION_ROLES)[number];

/** Kind: constant. Where a company is present online (core.web_presence). */
export const PLATFORMS = ["website", "linkedin", "instagram", "facebook", "x", "glassdoor", "youtube"] as const;
export type Platform = (typeof PLATFORMS)[number];

/** Kind: constant. How a match between a source record and a company was found. */
export const MATCH_METHODS = ["rcs_exact", "lei_exact", "cssf_exact", "fundhub_exact", "gleif_bridge", "domain_exact", "name_postcode", "name_only", "manual"] as const;
export type MatchMethod = (typeof MATCH_METHODS)[number];

/** Kind: constant. Decision on a match candidate or a news mention. "pending" waits for a person. */
export const MATCH_DECISIONS = ["auto", "pending", "accepted", "rejected"] as const;
export type MatchDecision = (typeof MATCH_DECISIONS)[number];

/** Kind: constant. State of a cross-source conflict (match.conflicts). */
export const CONFLICT_STATUSES = ["open", "resolved", "ignored"] as const;
export type ConflictStatus = (typeof CONFLICT_STATUSES)[number];

/** Kind: constant. States of one pipeline run. */
export const RUN_STATUSES = ["running", "succeeded", "failed", "paused"] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Kind: constant. Health of a logged-in source session (RCS through LuxTrust). */
export const SESSION_STATES = ["ok", "logged_out", "blocked", "unknown"] as const;
export type SessionState = (typeof SESSION_STATES)[number];

/** Kind: constant. Where a classification rule looks. */
export const RULE_KINDS = ["cssf_type", "cssf_activity", "rcs_legal_form", "keyword"] as const;
export type RuleKind = (typeof RULE_KINDS)[number];

/** Kind: constant. Text-extraction state of a downloaded document. */
export const TEXT_STATUSES = ["pending", "done", "failed", "needs_ocr"] as const;
export type TextStatus = (typeof TEXT_STATUSES)[number];

/** Kind: constant. Page kinds found when crawling a company website. */
export const WEB_PAGE_KINDS = ["home", "legal", "about", "team", "contact", "services", "clients", "other"] as const;
export type WebPageKind = (typeof WEB_PAGE_KINDS)[number];
