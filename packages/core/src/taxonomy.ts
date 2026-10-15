import {
  Briefcase,
  Building2,
  Calculator,
  Cpu,
  FileSpreadsheet,
  Landmark,
  Receipt,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";

/**
 * FundHub's standardized service taxonomy for the Luxembourg fund ecosystem.
 * Single source of truth for categories, sub-services and what we compare in each.
 */

/** Provider attributes a category highlights on comparator cards. */
export type HighlightField = "techStack" | "assetClasses" | "licences" | "certifications" | "regulatoryScope" | "footprint" | "mandates";

export type ServiceCategory = {
  slug: string;
  label: string;
  short: string;
  icon: LucideIcon;
  /** Canonical sub-services. Provider `services` must use these exact names. */
  services: readonly string[];
  /** When a fund needs this category. */
  whenNeeded: string;
  /** What to compare between providers in this category. */
  compareOn: readonly string[];
  /** Common issues our fee audits find in proposals. */
  redFlags: readonly string[];
  /** Attributes shown on comparator cards for this category. */
  highlights: readonly HighlightField[];
  /** How the provider's `mandates` count reads in this category. */
  mandatesLabel: string;
};

export const TAXONOMY = [
  {
    slug: "fund-administration",
    label: "Fund Administration",
    short: "NAV, fund accounting, transfer agency and investor reporting.",
    icon: Calculator,
    services: [
      "Fund Accounting & NAV Calculation",
      "Transfer Agency & Shareholder Register",
      "Investor Reporting & Communications",
      "Financial Statements & Annual Accounts",
      "PRIIPs KID Production",
    ],
    whenNeeded:
      "Every regulated Luxembourg fund (UCITS, SIF, RAIF, Part II) must appoint a central administrator. Unregulated SCSps usually appoint one too, for investor reporting and capital-call processing.",
    compareOn: [
      "NAV frequency and turnaround (T+1 vs T+5)",
      "Accounting engine and LP-portal connectivity (eFront, Investran, Yardi…)",
      "Asset-class experience: PE waterfalls, real-estate SPV look-through, debt servicing",
      "Pricing model: flat fee, basis points on NAV, or per-investor TA charges",
    ],
    redFlags: [
      "Per-SPV accounting charges not shown in the headline fee",
      "Transfer-agency charges per investor transaction on closed-ended funds",
      "Annual-accounts drafting billed separately at hourly rates",
    ],
    highlights: ["techStack", "assetClasses", "mandates"],
    mandatesLabel: "Funds administered",
  },
  {
    slug: "governance-domiciliation",
    label: "Corporate Governance, Domiciliation & Legal",
    short: "Registered office, corporate secretarial, directors and RCS/RBE filings.",
    icon: Building2,
    services: [
      "Domiciliation & Registered Office",
      "Corporate Secretarial",
      "Independent Directors",
      "RCS & RBE Filings",
      "Liquidation Management",
    ],
    whenNeeded:
      "Every Luxembourg entity needs a registered office, board meetings held in Luxembourg for substance, and timely RCS/RBE filings. Funds and SPVs usually outsource this to a licensed domiciliation agent.",
    compareOn: [
      "Licensed domiciliation agent status (Law of 31 May 1999)",
      "Pool and independence of directors: how many mandates each director holds",
      "Board-meeting logistics and minute turnaround",
      "Fixed annual fee vs. hourly billing for secretarial work",
    ],
    redFlags: [
      "Director fees bundled with domiciliation and impossible to unbundle",
      "Directors holding an excessive number of mandates (substance risk)",
      "Hourly billing for routine RCS/RBE updates",
    ],
    highlights: ["licences", "footprint", "mandates"],
    mandatesLabel: "Entities domiciled",
  },
  {
    slug: "regulatory-compliance",
    label: "Regulatory, Compliance & Risk",
    short: "AML/KYC, CSSF & BCL reporting, Annex IV, FATCA/CRS and risk.",
    icon: ShieldCheck,
    services: [
      "AML/CFT & KYC",
      "CSSF & BCL Reporting",
      "AIFMD Annex IV Reporting",
      "FATCA & CRS Reporting",
      "Risk Management & Oversight",
    ],
    whenNeeded:
      "Managers and funds must run investor and entity AML/KYC, appoint an RC/MLRO, and file regulatory reports with the CSSF, BCL and tax authorities. Emerging managers often outsource most of it.",
    compareOn: [
      "RC/MLRO-as-a-service availability and CSSF track record",
      "Screening tools and KYC refresh cycle",
      "Reporting coverage: Annex IV, BCL statistics, FATCA/CRS XML",
      "Pricing per investor, per entity, or flat",
    ],
    redFlags: [
      "Per-investor KYC refresh fees that scale unexpectedly",
      "Annex IV charged per report instead of per year",
      "MLRO services without a named, CSSF-approved individual",
    ],
    highlights: ["licences", "regulatoryScope", "techStack"],
    mandatesLabel: "Client mandates",
  },
  {
    slug: "corporate-accounting",
    label: "Corporate Administration & Accounting",
    short: "SPV & HoldCo bookkeeping, statutory accounts and consolidation.",
    icon: FileSpreadsheet,
    services: ["SPV & HoldCo Bookkeeping", "Statutory Accounts & Consolidation"],
    whenNeeded:
      "Private-markets funds hold assets through Luxembourg SOPARFIs and SPVs. Each one needs its own bookkeeping, statutory accounts filed with the RCS, and often consolidation.",
    compareOn: [
      "Volume of entities serviced and pricing per entity",
      "Lux GAAP vs IFRS expertise and consolidation capability",
      "Accounting software and reporting-package automation",
      "ISAE 3402 / SOC 1 controls reporting",
    ],
    redFlags: [
      "Per-transaction bookkeeping charges on active SPVs",
      "Separate fees for eCDF filing of annual accounts",
      "Year-end 'complexity' surcharges not defined in the engagement letter",
    ],
    highlights: ["techStack", "certifications", "mandates"],
    mandatesLabel: "Entities serviced",
  },
  {
    slug: "tax",
    label: "Tax Services",
    short: "VAT, net wealth tax, corporate income tax and transfer pricing.",
    icon: Receipt,
    services: ["VAT Compliance", "NWT & Corporate Income Tax", "Transfer Pricing Documentation"],
    whenNeeded:
      "Funds pay subscription tax, while SOPARFIs and SPVs are fully taxable. They need CIT/NWT returns, VAT registration, and transfer-pricing documentation for intra-group financing.",
    compareOn: [
      "Experience with fund SPVs, shareholder loans and profit-participating loans",
      "Fixed-fee compliance packages vs hourly advisory",
      "Transfer-pricing benchmarking capability",
      "Coverage of investor-side tax reporting (DE/AT/CH)",
    ],
    redFlags: [
      "Advisory hours billed on routine compliance returns",
      "Transfer-pricing reports re-billed in full every year rather than updated",
      "Tax advice tied to a referral from the structuring law firm",
    ],
    highlights: ["assetClasses", "footprint", "mandates"],
    mandatesLabel: "Entities filed",
  },
  {
    slug: "aifm-manco",
    label: "AIFM & ManCo Platform",
    short: "Third-party AIFM/ManCo, valuation, oversight and passporting.",
    icon: Briefcase,
    services: [
      "Portfolio Management Oversight",
      "Independent Valuation",
      "Third-Party Investment Oversight",
      "Cross-Border Distribution & Passporting",
    ],
    whenNeeded:
      "RAIFs and AIFs above the AIFMD thresholds need an authorised AIFM, and UCITS need a Chapter 15 ManCo. Sponsors without their own licence appoint a third-party ('super') ManCo.",
    compareOn: [
      "Licence: Chapter 15 ManCo, authorised AIFM, or both",
      "Asset classes the licence covers and delegation model",
      "Passporting footprint for marketing",
      "Fee model: bps of AuM with minimum annual fee",
    ],
    redFlags: [
      "High minimum fees that dominate small funds' total expense ratio",
      "Distribution-oversight charges per country added late",
      "Valuation outsourced to an affiliate without disclosure",
    ],
    highlights: ["licences", "assetClasses", "footprint"],
    mandatesLabel: "Funds under management",
  },
  {
    slug: "depositary-banking",
    label: "Banking, Depositary & Treasury",
    short: "Depositary, custody, cash management, FX hedging and LuxSE listing.",
    icon: Landmark,
    services: ["Depositary Services", "Cash Management & FX Hedging", "LuxSE Listing Agent"],
    whenNeeded:
      "UCITS need a full depositary bank. AIFs need an Art. 21 AIFMD depositary, which for illiquid assets can be a 'depositary-lite' professional (PSF). Every fund needs operating bank accounts.",
    compareOn: [
      "Full depositary (credit institution) vs depositary-lite (PSF)",
      "Asset-class coverage and ownership-verification process",
      "Cash-flow monitoring model and escalation",
      "bps fee on NAV with minimum fee, plus transaction charges",
    ],
    redFlags: [
      "Custody transaction fees on top of bps fees for illiquid funds",
      "Depositary bundled with the administrator at a hidden premium",
      "Minimum fees far above what the fund's NAV justifies",
    ],
    highlights: ["licences", "assetClasses", "regulatoryScope"],
    mandatesLabel: "Funds serviced",
  },
  {
    slug: "professional-support",
    label: "Professional Support Services",
    short: "Fund-software consultancy, cybersecurity, HR and interim staffing.",
    icon: Cpu,
    services: [
      "IT & Accounting Software Consultancy",
      "Helpdesk & Cybersecurity Audits",
      "HR Sourcing & Interim Management",
    ],
    whenNeeded:
      "Managers building Luxembourg substance need systems (eFront, Investran, Yardi…), DORA-ready IT security, and qualified local staff: permanent, interim, or seconded.",
    compareOn: [
      "Certified expertise on your fund-accounting stack",
      "Security certifications (ISO 27001, SOC 2) and DORA readiness",
      "Support PSF licence for regulated outsourcing",
      "Day rates vs fixed-scope projects",
    ],
    redFlags: [
      "Open-ended day-rate projects without a fixed scope",
      "Recruitment fees above 25% of first-year salary",
      "Software 'partners' paid commissions by the vendor they recommend",
    ],
    highlights: ["certifications", "techStack", "licences"],
    mandatesLabel: "Client mandates",
  },
] as const satisfies readonly ServiceCategory[];

export type CategorySlug = (typeof TAXONOMY)[number]["slug"];
export const CATEGORY_SLUGS = TAXONOMY.map((c) => c.slug) as [CategorySlug, ...CategorySlug[]];
export const ALL_SERVICES: readonly string[] = TAXONOMY.flatMap((c) => c.services);

const BY_SLUG = new Map<string, ServiceCategory>(TAXONOMY.map((c) => [c.slug, c]));

export function getCategory(slug: string): ServiceCategory | undefined {
  return BY_SLUG.get(slug);
}

export function categoryLabel(slug: string): string {
  return BY_SLUG.get(slug)?.label ?? slug;
}

export const HIGHLIGHT_LABELS: Record<HighlightField, string> = {
  techStack: "Tech stack",
  assetClasses: "Asset classes",
  licences: "Licences",
  certifications: "Certifications",
  regulatoryScope: "Regulatory scope",
  footprint: "Footprint",
  mandates: "Mandates",
};
