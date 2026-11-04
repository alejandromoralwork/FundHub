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

import type { EntityKind, RuleKind } from "./enums";

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
  entityKind?: EntityKind;
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
 * Conservative on purpose: ManCos and banks are not all third-party providers, so they are NOT flagged as
 * service providers here — the web agent or a person decides (tier 2 makes sure they get looked at).
 */
export const RULES: RuleSeed[] = [
  // --- CSSF entity types (baseline)
  { kind: "cssf_type", match: "SPP", isServiceProvider: true, entityKind: "service_provider", tier: 2, priority: 10, note: "Specialised PFS" },
  { kind: "cssf_type", match: "SUP", isServiceProvider: true, entityKind: "service_provider", category: "professional-support", tier: 2, priority: 10, note: "Support PFS" },
  { kind: "cssf_type", match: "IF", entityKind: "financial_institution", category: "financial-institutions", subcategory: "financial-institutions--investment-firms", tier: 1, priority: 10 },
  { kind: "cssf_type", match: "B", entityKind: "bank", category: "financial-institutions", subcategory: "financial-institutions--banks", tier: 2, priority: 10 },
  ...each(["C15", "C16", "AIFM_AUT"], { entityKind: "asset_manager", category: "aifm-manco", tier: 2, priority: 10 }, "cssf_type"),
  ...each(["AIFM_REG", "AIFM_REG_LU_OTHER_EU_MEMBER_STATE"], { entityKind: "asset_manager", category: "aifm-manco", tier: 1, priority: 10 }, "cssf_type"),
  { kind: "cssf_type", match: "OPC", entityKind: "fund", category: "funds", subcategory: "funds--ucis-2010", tier: 0, priority: 10 },
  { kind: "cssf_type", match: "FIS", entityKind: "fund", category: "funds", subcategory: "funds--sif", tier: 0, priority: 10 },
  { kind: "cssf_type", match: "SIC", entityKind: "fund", category: "funds", subcategory: "funds--sicar", tier: 0, priority: 10 },
  { kind: "cssf_type", match: "TIT", entityKind: "fund", category: "funds", subcategory: "funds--securitisation", tier: 0, priority: 10 },
  { kind: "cssf_type", match: "PF", entityKind: "fund", category: "funds", subcategory: "funds--pension", tier: 0, priority: 10 },
  ...each(["PI", "EMI", "AIP", "SPE"], { entityKind: "financial_institution", category: "financial-institutions", subcategory: "financial-institutions--payment", tier: 0, priority: 10 }, "cssf_type"),
  ...each(["CASP", "VAP", "EMONEY_TOKEN", "REFERENCE_TOKEN"], { entityKind: "financial_institution", category: "financial-institutions", subcategory: "financial-institutions--crypto", tier: 0, priority: 10 }, "cssf_type"),
  ...each(["IHC", "CFI"], { entityKind: "financial_institution", category: "financial-institutions", subcategory: "financial-institutions--holdings", tier: 0, priority: 10 }, "cssf_type"),
  ...each(["CRF", "DCT", "MR", "MTF", "OTF", "AGT", "ICI", "LM"], { entityKind: "financial_institution", category: "financial-institutions", subcategory: "financial-institutions--other", tier: 0, priority: 10 }, "cssf_type"),

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
