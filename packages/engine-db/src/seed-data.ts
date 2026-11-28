/**
 * FILE: packages/engine-db/src/seed-data.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: The starting reference data of the engine: extra activity categories (beyond the 8 website
 *   categories, which come from packages/core/src/taxonomy.ts), the classification rules that turn CSSF
 *   entity types and activity codes into is_service_provider + category/subcategory + tier, and the RCS
 *   number prefixes to census. Edit here, then `npm run engine:db:seed` (idempotent upsert).
 * WHERE IT RUNS: read by scripts/seed.ts and by tests.
 * TYPESCRIPT YOU WILL SEE HERE: type aliases, `as const`, object literals.
 */

import type { MandateRole, CompanyKind, EngineSource, Layer, ReviewMode, RuleKind, SourceKind, AcquisitionMethod } from "./enums";
import type { ReviewConditions } from "./schema/ops";

/** Kind: type alias. A level-1 category with its level-2 subcategories ({ slug, label }). */
export type CategorySeed = { slug: string; label: string; serviceProvider: boolean; subs: { slug: string; label: string }[] };

/**
 * Kind: constant. Level-1 roots that are NOT website directory categories: the rest of the market the engine
 * also tracks (funds, financial institutions, corporates). Website categories are added by the seed script.
 */
export const EXTRA_CATEGORIES: CategorySeed[] = [
  {
    slug: "funds",
    label: "Investment Funds & Vehicles",
    serviceProvider: false,
    subs: [
      { slug: "funds--ucis-2010", label: "UCIs (Law of 17 December 2010)" },
      { slug: "funds--sif", label: "Specialised Investment Funds (SIF)" },
      { slug: "funds--sicar", label: "SICARs" },
      { slug: "funds--securitisation", label: "Securitisation undertakings" },
      { slug: "funds--pension", label: "Pension funds" },
      { slug: "funds--raif", label: "RAIFs" },
      { slug: "funds--unregulated", label: "Unregulated vehicles (SCSp, SCS, SPV)" },
    ],
  },
  {
    slug: "financial-institutions",
    label: "Financial Institutions",
    serviceProvider: false,
    subs: [
      { slug: "financial-institutions--banks", label: "Banks" },
      { slug: "financial-institutions--investment-firms", label: "Investment firms" },
      { slug: "financial-institutions--payment", label: "Payment & e-money institutions" },
      { slug: "financial-institutions--crypto", label: "Crypto-asset service providers" },
      { slug: "financial-institutions--holdings", label: "Financial & investment holding companies" },
      { slug: "financial-institutions--other", label: "Other supervised entities" },
    ],
  },
  {
    slug: "corporate",
    label: "Corporates",
    serviceProvider: false,
    subs: [
      { slug: "corporate--holding", label: "Holding companies (Soparfi)" },
      { slug: "corporate--operating", label: "Operating companies" },
      { slug: "corporate--other", label: "Other" },
    ],
  },
];

/**
 * Kind: type alias. One classification rule as written in this file. `category` / `subcategory` are slugs
 * (resolved to ids by the seed script). Subcategory slugs of website categories are
 * `<category-slug>--<slugified service name>` (see subSlug()).
 */
export type RuleSeed = {
  kind: RuleKind;
  match: string;
  isServiceProvider?: boolean;
  companyKind?: CompanyKind;
  category?: string;
  subcategory?: string;
  tier?: number;
  priority: number;
  note?: string;
};

/**
 * Kind: function. The subcategory slug for a website category service.
 * @param category  type `string` — e.g. "fund-administration".
 * @param service   type `string` — e.g. "Transfer Agency & Shareholder Register".
 * @returns `string` — e.g. "fund-administration--transfer-agency-shareholder-register".
 */
export function subSlug(category: string, service: string): string {
  const s = service
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return `${category}--${s}`;
}

// Shorthands for the subcategories used below.
const FA = (s: string) => subSlug("fund-administration", s);
const GD = (s: string) => subSlug("governance-domiciliation", s);
const DB = (s: string) => subSlug("depositary-banking", s);
const AM = (s: string) => subSlug("aifm-manco", s);
const PS = (s: string) => subSlug("professional-support", s);

/** Kind: helper. One rule per code, same outputs. */
const each = (codes: string[], r: Omit<RuleSeed, "match" | "kind">, kind: RuleKind = "cssf_activity"): RuleSeed[] =>
  codes.map((match) => ({ kind, match, ...r }));

/**
 * Kind: constant. The starting rule set. Priority: for each output field, the highest-priority rule that
 * sets it wins. CSSF *type* rules (10) give the baseline; *activity* rules (12–25) refine the category.
 * Service provider = any company providing services to funds or corporates: CSSF-licensed PFS, banks (depositary,
 * banking), investment firms, ManCos / AIFMs (management services), and — by name (kind "keyword", regex on
 * the plain name, used only when the company is not a fund / fund vehicle) — law, audit, tax, fiduciary /
 * domiciliation, fund-services and advisory firms, which the CSSF does not license.
 */
export const RULES: RuleSeed[] = [
  // --- CSSF entity types (baseline)
  { kind: "cssf_type", match: "SPP", isServiceProvider: true, companyKind: "service_provider", tier: 2, priority: 10, note: "Specialised PFS" },
  { kind: "cssf_type", match: "SUP", isServiceProvider: true, companyKind: "service_provider", category: "professional-support", tier: 2, priority: 10, note: "Support PFS" },
  { kind: "cssf_type", match: "IF", isServiceProvider: true, companyKind: "financial_institution", category: "financial-institutions", subcategory: "financial-institutions--investment-firms", tier: 1, priority: 10 },
  { kind: "cssf_type", match: "B", isServiceProvider: true, companyKind: "bank", category: "financial-institutions", subcategory: "financial-institutions--banks", tier: 2, priority: 10 },
  ...each(["C15", "C16", "AIFM_AUT"], { isServiceProvider: true, companyKind: "asset_manager", category: "aifm-manco", tier: 2, priority: 10 }, "cssf_type"),
  ...each(["AIFM_REG", "AIFM_REG_LU_OTHER_EU_MEMBER_STATE"], { isServiceProvider: true, companyKind: "asset_manager", category: "aifm-manco", tier: 1, priority: 10 }, "cssf_type"),
  { kind: "cssf_type", match: "OPC", companyKind: "fund", category: "funds", subcategory: "funds--ucis-2010", tier: 0, priority: 10 },
  { kind: "cssf_type", match: "FIS", companyKind: "fund", category: "funds", subcategory: "funds--sif", tier: 0, priority: 10 },
  { kind: "cssf_type", match: "SIC", companyKind: "fund", category: "funds", subcategory: "funds--sicar", tier: 0, priority: 10 },
  { kind: "cssf_type", match: "TIT", companyKind: "fund", category: "funds", subcategory: "funds--securitisation", tier: 0, priority: 10 },
  { kind: "cssf_type", match: "PF", companyKind: "fund", category: "funds", subcategory: "funds--pension", tier: 0, priority: 10 },
  ...each(["PI", "EMI", "AIP", "SPE"], { companyKind: "financial_institution", category: "financial-institutions", subcategory: "financial-institutions--payment", tier: 0, priority: 10 }, "cssf_type"),
  ...each(["CASP", "VAP", "EMONEY_TOKEN", "REFERENCE_TOKEN"], { companyKind: "financial_institution", category: "financial-institutions", subcategory: "financial-institutions--crypto", tier: 0, priority: 10 }, "cssf_type"),
  ...each(["IHC", "CFI"], { companyKind: "financial_institution", category: "financial-institutions", subcategory: "financial-institutions--holdings", tier: 0, priority: 10 }, "cssf_type"),
  ...each(["CRF", "DCT", "MR", "MTF", "OTF", "AGT", "ICI", "LM"], { companyKind: "financial_institution", category: "financial-institutions", subcategory: "financial-institutions--other", tier: 0, priority: 10 }, "cssf_type"),

  // --- Names (kind "keyword": a regular expression on the plain name — lower case, no accents, punctuation as
  //     spaces). Below the CSSF rules (priority 5–6), so a licence decides kind and category; they mark firms the
  //     CSSF does not license. Never applied to funds and fund vehicles. The generic word rules also skip names
  //     that read as investment vehicles (SCSp, lending, investments, holding, fund…); brand rules do not.
  //     Edit / add in the Database module.
  { kind: "keyword", match: "^(?!.*\\b(scsp|lending|finance|financing|investments?|invest|opportunit\\w*|partnership|holdings?|fund|funds|properties|real estate|capital)\\b).*\\b(avocats?|avocat a la cour|law firm|lawyers?|rechtsanw\\w*|attorneys?|solicitors?|legal)\\b", isServiceProvider: true, companyKind: "service_provider", category: "governance-domiciliation", priority: 6, note: "Law firms (legal advisers)" },
  { kind: "keyword", match: "\\b(arendt|elvinger|loyens|linklaters|clifford chance|allen overy|a o shearman|ogier|maples|walkers|dentons|dla piper|baker mckenzie|stibbe|nautadutilh|bonn steichen|gsk stockmann|kleyr grasso|molitor|wildgen|harney|carey olsen|mourant|simmons simmons|hogan lovells|white case|freshfields|pinsent masons|eversheds|osborne clarke|vandenbulke|castegnaro|schiltz schiltz)\\b", isServiceProvider: true, companyKind: "service_provider", category: "governance-domiciliation", priority: 5, note: "Luxembourg law-firm brands" },
  { kind: "keyword", match: "^(?!.*\\b(scsp|lending|finance|financing|investments?|invest|opportunit\\w*|partnership|holdings?|fund|funds|properties|real estate|capital)\\b).*\\b(audit\\w*|revision|reviseurs?|wirtschaftsprufung\\w*|chartered accountants?|expert comptables?|experts comptables)\\b", isServiceProvider: true, companyKind: "service_provider", category: "corporate-accounting", priority: 6, note: "Audit / accounting firms" },
  { kind: "keyword", match: "\\b(deloitte|pricewaterhousecoopers|pwc|kpmg|ernst young|grant thornton|bdo|forvis|mazars|rsm|baker tilly|kreston|crowe|nexia|atwell|ecovis)\\b|^ey\\b", isServiceProvider: true, companyKind: "service_provider", category: "corporate-accounting", priority: 5, note: "Audit / advisory brands" },
  { kind: "keyword", match: "^(?!.*\\b(scsp|lending|finance|financing|investments?|invest|opportunit\\w*|partnership|holdings?|fund|funds|properties|real estate|capital)\\b).*\\b(tax|taxes|fiscal|fiscalite|steuerberat\\w*)\\b", isServiceProvider: true, companyKind: "service_provider", category: "tax", priority: 5, note: "Tax advisers" },
  { kind: "keyword", match: "^(?!.*\\b(scsp|lending|finance|financing|investments?|invest|opportunit\\w*|partnership|holdings?|fund|funds|properties|real estate|capital)\\b).*\\b(fiduciaire|fiduciary|trust company|trust services|trustees?|corporate services|domiciliation|management services|business services|company services|accounting|comptab\\w*)\\b", isServiceProvider: true, companyKind: "service_provider", category: "governance-domiciliation", priority: 5, note: "Fiduciaries, domiciliation and corporate services" },
  { kind: "keyword", match: "\\b(alter domus|intertrust|csc global|tmf|vistra|iq eq|ocorian|jtc|aztec|sanne|apex fund services|apex group|citco|centralis|lux business management)\\b", isServiceProvider: true, companyKind: "service_provider", category: "fund-administration", priority: 5, note: "Fund & corporate administrators (brands)" },
  { kind: "keyword", match: "\\b(fund services|fund administration|fund admin|investor services|transfer agen\\w*|fund solutions|fund partners|registrar)\\b", isServiceProvider: true, companyKind: "service_provider", category: "fund-administration", priority: 6, note: "Fund administration" },
  { kind: "keyword", match: "^(?!.*\\b(scsp|lending|finance|financing|investments?|invest|opportunit\\w*|partnership|holdings?|fund|funds|properties|real estate|capital)\\b).*\\b(consulting|consultants?|conseils?|advisory|regulatory|compliance|governance)\\b", isServiceProvider: true, companyKind: "service_provider", category: "professional-support", priority: 4, note: "Consulting / advisory / compliance" },

  // --- CSSF activity / status codes (refine the category)
  ...each(["OST_SPP_AA", "ACT_SUP_AA", "OST_IF_AA", "OST_PI_AA"], { isServiceProvider: true, category: "fund-administration", subcategory: FA("Fund Accounting & NAV Calculation"), tier: 2, priority: 21 }),
  ...each(["ACT_SPP_ATR", "OST_SUP_ATR", "OST_IF_ATR"], { isServiceProvider: true, category: "fund-administration", subcategory: FA("Transfer Agency & Shareholder Register"), tier: 2, priority: 20 }),
  ...each(["ACT_SPP_DOM", "OST_IF_DOM", "OST_SUP_DOM"], { isServiceProvider: true, category: "governance-domiciliation", subcategory: GD("Domiciliation & Registered Office"), tier: 2, priority: 20 }),
  ...each(["ACT_SPP_PCG", "OST_IF_PCG", "OST_SUP_PCG"], { isServiceProvider: true, category: "governance-domiciliation", subcategory: GD("Corporate Secretarial"), tier: 2, priority: 19 }),
  ...each(["ACT_SPP_ACC", "OST_SPP_ACC", "ACT_SUP_ACC", "OST_IF_ACC", "OST_PI_ACC"], { isServiceProvider: true, category: "fund-administration", subcategory: FA("Investor Reporting & Communications"), priority: 15 }),
  ...each(["ACT_SPP_DEP", "ACT_IF_DEP", "OST_IF_DEP"], { isServiceProvider: true, category: "depositary-banking", subcategory: DB("Depositary Services"), tier: 2, priority: 22 }),
  ...each(["ACT_SPP_DEPAAIF", "ACT_IF_DEPAAIF", "OST_IF_DEPAAIF"], { isServiceProvider: true, category: "depositary-banking", subcategory: DB("Depositary Services"), tier: 2, priority: 12, note: "Depositary of other assets: often a side licence, low priority" }),
  ...each(["ACT_SUP_IT", "OST_SPP_IT", "OST_IF_IT", "OST_PI_IT", "OST_PI_ITSEC"], { isServiceProvider: true, category: "professional-support", subcategory: PS("IT & Accounting Software Consultancy"), priority: 14 }),
  ...each(["ACT_SUP_PSDC-C", "ACT_SUP_PSDC-D", "ACT_SUP_ARM"], { isServiceProvider: true, category: "professional-support", subcategory: PS("IT & Accounting Software Consultancy"), priority: 13 }),
  ...each(["OST_IF_GOPC"], { isServiceProvider: true, category: "aifm-manco", subcategory: AM("Third-Party Investment Oversight"), tier: 2, priority: 18 }),
];

/** Kind: constant. RCS number prefixes. Only B (commercial companies) is enabled to start; verify the others on LBR. */
export const RCS_PREFIXES: { prefix: string; label: string; enabled: boolean }[] = [
  { prefix: "B", label: "Commercial companies (sociétés commerciales)", enabled: true },
  { prefix: "A", label: "Sole traders (commerçants personnes physiques) — verify", enabled: false },
  { prefix: "C", label: "Civil companies (sociétés civiles) — verify", enabled: false },
  { prefix: "E", label: "Economic interest groupings (GIE/GEIE) — verify", enabled: false },
  { prefix: "F", label: "Non-profit associations (ASBL) — verify", enabled: false },
  { prefix: "G", label: "Foundations — verify", enabled: false },
  { prefix: "J", label: "Other legal persons — verify", enabled: false },
];

// ============================================================ pipeline control (ops.*)

/** Kind: type alias. One source registry row (ops.sources). */
export type SourceSeed = {
  code: EngineSource;
  system: string;
  name: string;
  kind: SourceKind;
  acquisition: AcquisitionMethod;
  homepage?: string;
  description: string;
  trust: number;
  enabled: boolean;
  refreshDays?: [number, number, number];
  rateLimitPerMin?: number;
  complianceNote?: string;
  retentionDays?: number;
};

/**
 * Kind: constant. The source registry. LBR is the master list of every Luxembourg company; the others enrich
 * and cross-check it. Social / people / reviews sources are registered but disabled (phase 2): they collect
 * public pages only, at human pace, and keep personal data to name + role + profile link with a retention limit.
 */
export const SOURCES: SourceSeed[] = [
  { code: "rcs", system: "LBR", name: "LBR company pages", kind: "register", acquisition: "browser_capture", homepage: "https://www.lbr.lu", description: "Luxembourg Business Registers: the official RCS record of every company (name, legal form, status, address, filings). Captured by a person through the FundHub LBR Capture extension (LBR blocks robots).", trust: 1, enabled: true, refreshDays: [365, 30, 7] },
  { code: "lbr_bulk", system: "LBR", name: "LBR extracts & search lists", kind: "register", acquisition: "bulk_file", homepage: "https://www.lbr.lu", description: "Official LBR data extracts (CSV) and LBR search-result lists: the complete list of RCS numbers and names.", trust: 2, enabled: true },
  { code: "gleif", system: "GLEIF", name: "GLEIF LEI records", kind: "secondary_register", acquisition: "api", homepage: "https://www.gleif.org", description: "Global LEI index: Luxembourg legal entities with an LEI, their RCS number, addresses and parent relations. Daily delta.", trust: 3, enabled: true, rateLimitPerMin: 60 },
  { code: "cssf", system: "CSSF", name: "CSSF entity register", kind: "regulator", acquisition: "api", homepage: "https://www.cssf.lu", description: "Supervised entities: licences (authorised statuses), investment services, fund compartments.", trust: 2, enabled: true, refreshDays: [7, 7, 7], rateLimitPerMin: 60 },
  { code: "fundhub", system: "FundHub", name: "FundHub accounts", kind: "self_declared", acquisition: "database", homepage: "https://fundhub.lu", description: "What providers declare on fundhub.lu: their listing, approved claims and approved profile edits.", trust: 4, enabled: true },
  { code: "website", system: "Company website", name: "Company websites", kind: "web", acquisition: "crawl", description: "The company's own site: legal notice (verifies RCS number), about, services, team, contact, client lists, social links. Extracted with AI.", trust: 5, enabled: true, refreshDays: [180, 90, 30], rateLimitPerMin: 20, complianceNote: "Public pages only; respects robots.txt. Team names become people (name + title + page link only)." },
  { code: "news", system: "News", name: "Newspapers & press releases", kind: "news", acquisition: "rss", description: "Luxembourg newspaper feeds and press releases, plus a per-company news search for tier 1–2 companies. Articles are matched to the companies they mention.", trust: 6, enabled: true, complianceNote: "Only title, link and a short snippet are shown; full text is kept for matching only." },
  { code: "linkedin", system: "LinkedIn", name: "LinkedIn company pages", kind: "people", acquisition: "crawl", homepage: "https://www.linkedin.com", description: "Company page (size, industry, followers) and public employee listings.", trust: 6, enabled: false, rateLimitPerMin: 2, retentionDays: 365, complianceNote: "Phase 2. LinkedIn's terms forbid scraping; public pages only, no login, human pace. People: name, title, profile URL only; erased on GDPR request; purged after retention." },
  { code: "glassdoor", system: "Glassdoor", name: "Glassdoor employer pages", kind: "reviews", acquisition: "crawl", homepage: "https://www.glassdoor.com", description: "Employer rating and review count.", trust: 7, enabled: false, rateLimitPerMin: 2, complianceNote: "Phase 2. Terms forbid scraping; public pages only. Aggregate rating only, no review texts." },
  { code: "instagram", system: "Instagram", name: "Instagram profiles", kind: "social", acquisition: "crawl", homepage: "https://www.instagram.com", description: "Company profile, followers, posting activity.", trust: 8, enabled: false, rateLimitPerMin: 2, complianceNote: "Phase 2. Public profile data only." },
  { code: "facebook", system: "Facebook", name: "Facebook pages", kind: "social", acquisition: "crawl", homepage: "https://www.facebook.com", description: "Company page, followers, contact details.", trust: 8, enabled: false, rateLimitPerMin: 2, complianceNote: "Phase 2. Public page data only." },
  { code: "x", system: "X", name: "X profiles", kind: "social", acquisition: "crawl", homepage: "https://x.com", description: "Company profile, followers, activity.", trust: 8, enabled: false, rateLimitPerMin: 2, complianceNote: "Phase 2. Public profile data only." },
  { code: "manual", system: "FundHub staff", name: "Staff edits", kind: "staff", acquisition: "manual", description: "Corrections made by FundHub staff in the console. Always wins; clearing an edit hands the field back to the sources.", trust: 0, enabled: true },
  { code: "engine", system: "FundHub engine", name: "Inferred by the engine", kind: "derived", acquisition: "database", description: "Facts the engine infers from other data, e.g. a fund administrator's domiciliation clients from a shared registered address (job domiciliation_match). Lower confidence; staff and documents win.", trust: 9, enabled: true },
];

/**
 * Kind: constant. Which sources may set each golden field, most trusted first ("manual" is added in front of
 * every list by the seed). Legal facts follow the registers; descriptive facts follow what the company itself
 * says (FundHub account, then its website). Licences are not here: they only come from the CSSF.
 */
export const PRECEDENCE: Record<string, EngineSource[]> = {
  name: ["rcs", "lbr_bulk", "cssf", "gleif", "fundhub", "website"],
  legalForm: ["rcs", "lbr_bulk", "cssf", "gleif"],
  status: ["rcs", "lbr_bulk", "cssf", "gleif"],
  address: ["rcs", "lbr_bulk", "cssf", "gleif", "fundhub", "website"],
  registrationDate: ["rcs", "lbr_bulk", "gleif"],
  lei: ["gleif", "cssf"],
  rcsNumber: ["rcs", "lbr_bulk", "cssf", "gleif", "fundhub"],
  website: ["fundhub", "website", "cssf", "gleif"],
  websiteVerifiedAt: ["website"],
  description: ["fundhub", "website", "linkedin"],
  phone: ["fundhub", "website", "facebook"],
  email: ["fundhub", "website"],
  headcount: ["fundhub", "linkedin", "website"],
  foundedYear: ["fundhub", "website", "linkedin"],
  operatingCountries: ["fundhub", "website"],
  services: ["fundhub", "website"],
  logo: ["fundhub", "website"],
};

/** Kind: type alias. One staging approval policy. */
export type ReviewPolicySeed = { source: EngineSource | "*"; scope?: string; mode: ReviewMode; conditions?: ReviewConditions; sampleRate?: number; note: string };

const LEGAL = ["name", "status", "legalForm", "rcsNumber", "lei", "address"];

/**
 * Kind: constant. Starting approval-gate policies. Registers flow automatically unless a legal fact of a known
 * record changes or the parser changed; self-declared and social data always wait for a person; AI website
 * extractions wait when unsure. All are editable on the console's Sources page.
 */
export const REVIEW_POLICIES: ReviewPolicySeed[] = [
  { source: "*", mode: "auto", note: "Default: no approval needed." },
  { source: "rcs", mode: "review_if", conditions: { protectedAttributes: LEGAL, parserChanged: true }, note: "Hold when a legal fact changes or after a parser update." },
  { source: "lbr_bulk", mode: "review_if", conditions: { protectedAttributes: ["name", "status"] }, note: "Hold name / status changes from extracts." },
  { source: "gleif", mode: "review_if", conditions: { protectedAttributes: LEGAL, parserChanged: true }, note: "Hold when a legal fact changes or after a parser update." },
  { source: "cssf", mode: "review_if", conditions: { protectedAttributes: ["name", "status", "lei"], parserChanged: true }, note: "Hold name / status / LEI changes or after a parser update." },
  { source: "fundhub", mode: "review_all", note: "Self-declared data: a person checks every change before it counts." },
  { source: "website", mode: "review_if", conditions: { minConfidence: 0.8, newCompany: true }, note: "Hold AI extractions below 80% confidence." },
  { source: "news", mode: "auto", note: "Articles flow; uncertain company mentions wait in Review → Mentions." },
  { source: "linkedin", mode: "review_all", note: "Phase 2: people data is always checked." },
  { source: "glassdoor", mode: "review_all", note: "Phase 2." },
  { source: "instagram", mode: "review_all", note: "Phase 2." },
  { source: "facebook", mode: "review_all", note: "Phase 2." },
  { source: "x", mode: "review_all", note: "Phase 2." },
];

/**
 * Kind: constant. News feeds polled by `news_poll` (checked to answer with RSS in Nov 2026). Paperjam and
 * Delano publish no public feed; their articles arrive through the per-company news search.
 */
/**
 * Kind: constant. Service-mandate roles (ops.mandate_roles). `exclusive`: one provider at a time per fund — the
 * database refuses overlapping episodes for these. Labels and flags are editable in the Database module.
 */
export const MANDATE_ROLE_SEED: { code: MandateRole; label: string; exclusive: boolean; regulated: boolean; appliesTo: "fund" | "sub_fund" | "both" }[] = [
  { code: "management_company", label: "Management company (UCITS ManCo)", exclusive: true, regulated: true, appliesTo: "fund" },
  { code: "aifm", label: "AIFM", exclusive: true, regulated: true, appliesTo: "fund" },
  { code: "investment_manager", label: "Investment manager (delegated)", exclusive: false, regulated: true, appliesTo: "both" },
  { code: "investment_adviser", label: "Investment adviser", exclusive: false, regulated: false, appliesTo: "both" },
  { code: "depositary", label: "Depositary", exclusive: true, regulated: true, appliesTo: "fund" },
  { code: "central_administration", label: "Central administration (fund administrator)", exclusive: true, regulated: true, appliesTo: "fund" },
  { code: "transfer_agent", label: "Transfer agent", exclusive: false, regulated: true, appliesTo: "fund" },
  { code: "registrar", label: "Registrar", exclusive: false, regulated: true, appliesTo: "fund" },
  { code: "auditor", label: "Auditor (réviseur d'entreprises agréé)", exclusive: true, regulated: true, appliesTo: "fund" },
  { code: "domiciliation_agent", label: "Domiciliation agent", exclusive: true, regulated: true, appliesTo: "fund" },
  { code: "distributor", label: "Global distributor", exclusive: false, regulated: false, appliesTo: "both" },
  { code: "paying_agent", label: "Paying agent", exclusive: false, regulated: false, appliesTo: "fund" },
  { code: "legal_adviser", label: "Legal adviser", exclusive: false, regulated: false, appliesTo: "fund" },
  { code: "prime_broker", label: "Prime broker", exclusive: false, regulated: false, appliesTo: "both" },
  { code: "listing_agent", label: "Listing agent", exclusive: false, regulated: false, appliesTo: "both" },
  { code: "director", label: "Board director (company)", exclusive: false, regulated: false, appliesTo: "fund" },
  { code: "service_provider", label: "Service provider (role not stated)", exclusive: false, regulated: false, appliesTo: "both" },
];

export const NEWS_FEEDS: { name: string; url: string; language: string; enabled: boolean }[] = [
  { name: "Luxembourg Times", url: "https://www.luxtimes.lu/rss", language: "en", enabled: true },
  { name: "Luxemburger Wort", url: "https://www.wort.lu/rss", language: "de", enabled: true },
  { name: "RTL Today", url: "https://today.rtl.lu/rss/headlines", language: "en", enabled: true },
  { name: "RTL.lu", url: "https://www.rtl.lu/rss/headlines", language: "lb", enabled: true },
  { name: "CSSF news", url: "https://www.cssf.lu/en/feed/", language: "en", enabled: true },
  { name: "CSSF press releases", url: "https://www.cssf.lu/en/press-releases/feed/", language: "en", enabled: true },
];

/** Kind: constant. Data-quality checks computed daily by `quality_run` (pipeline/quality.ts). */
export const QUALITY_CHECKS: { code: string; label: string; description: string; layer: Layer; min?: number; max?: number }[] = [
  { code: "lbr_coverage", label: "LBR coverage", description: "Companies with an RCS number held / RCS numbers known to exist (LBR number space).", layer: "core", min: 0.95 },
  { code: "multi_source", label: "Cross-checked companies", description: "Share of companies stated by 2 or more sources.", layer: "core", min: 0.5 },
  { code: "match_rate", label: "Match rate", description: "Share of found source records linked to a company.", layer: "match", min: 0.98 },
  { code: "open_conflicts", label: "Open conflicts", description: "Number of open cross-source disagreements (count).", layer: "match", max: 500 },
  { code: "review_backlog", label: "Approval backlog", description: "Records waiting at the staging gate for more than 3 days (count).", layer: "staging", max: 50 },
  { code: "reject_rate", label: "Reject rate (7 days)", description: "Rejected values / claims written in the last 7 days.", layer: "clean", max: 0.02 },
  { code: "freshness", label: "Freshness", description: "Share of scheduled records refreshed on time (next_fetch_at not overdue by more than 2 days).", layer: "staging", min: 0.9 },
  { code: "website_completeness", label: "Websites known", description: "Share of active service providers with a website.", layer: "core", min: 0.9 },
  { code: "filings_truncated", label: "Filings lists possibly cut", description: "LBR company pages saved with exactly 200, 400… filings: LBR pages its list by 200, so these were probably saved before the extension read every page. Save them again (count).", layer: "clean", max: 0 },
  { code: "website_verified", label: "Websites verified", description: "Share of known websites verified by their legal notice.", layer: "core", min: 0.6 },
];
