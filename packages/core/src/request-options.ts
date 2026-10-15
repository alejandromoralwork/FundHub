import { AWARD_CATEGORY_NAMES } from "./awards";
import type { RequestType } from "./enums";
import { TAXONOMY } from "./taxonomy";

export const FUND_STRUCTURES = [
  "RAIF",
  "SIF",
  "SICAV (UCITS)",
  "SICAV Part II",
  "SICAR",
  "SCSp / SCS",
  "ELTIF",
  "SOPARFI / HoldCo",
  "Securitisation vehicle",
  "Not yet decided",
  "Other",
] as const;

/** Stored value → display label. ASCII values keep form posts encoding-safe. */
export const AUM_BAND_LABELS = {
  "lt-100m": "< €100m",
  "100m-250m": "€100m – €250m",
  "250m-1bn": "€250m – €1bn",
  "1bn-5bn": "€1bn – €5bn",
  "gt-5bn": "> €5bn",
} as const;
export type AumBand = keyof typeof AUM_BAND_LABELS;
export const AUM_BANDS = Object.keys(AUM_BAND_LABELS) as [AumBand, ...AumBand[]];

/** FundHub's buy-side advisory services. */
export const ADVISORY_SERVICES = [
  {
    id: "negotiation",
    label: "Fee Negotiation & Meeting Accompaniment",
    description:
      "A senior FundHub expert comes with you, in person or virtually, to pricing meetings with service providers and negotiates on your side of the table using our market data.",
  },
  {
    id: "fund-setup",
    label: "Fund & Activity Set-up Support",
    description:
      "Setting up in Luxembourg: choosing the structure and the providers it legally requires, realistic budgets, substance (office, directors, staff), timeline, and onboarding.",
  },
  {
    id: "fee-audit",
    label: "Bespoke Fee Audit",
    description:
      "We benchmark an existing or proposed fee schedule line by line, then flag hidden line items, inflated out-of-pocket expenses and services you don't need.",
  },
  {
    id: "vendor-selection",
    label: "Vendor Selection & RFP Management",
    description:
      "We build a standardized RFP, invite a balanced shortlist (boutique to institutional), normalize the answers and score them like for like.",
  },
] as const;
export const ADVISORY_SERVICE_LABELS = ADVISORY_SERVICES.map((s) => s.label);

/** Private (bespoke) Data Intelligence services. */
export const DATA_SERVICES = [
  "Custom fee benchmarking",
  "Competitor & market-share analysis",
  "Market-entry study for Luxembourg",
  "Software & technology adoption study",
  "Bespoke data extract / API access",
] as const;

/** Legacy: what a service provider could ask FundHub for before accounts existed. */
export const PROVIDER_INTERESTS = [
  "Claim / correct my free profile",
  "Pro account (profile control)",
  "Data verification (free)",
  "Quarterly intelligence reports",
  "FundHub Market Awards",
] as const;

export type ServiceGroup = { label?: string; options: readonly string[] };

/** Allowed `servicesNeeded` values per request type. */
export const SERVICE_GROUPS: Record<RequestType, ServiceGroup[]> = {
  rfi: TAXONOMY.map((c) => ({ label: c.label, options: c.services })),
  advisory: [{ options: ADVISORY_SERVICE_LABELS }],
  data: [{ options: DATA_SERVICES }],
  awards: [{ options: AWARD_CATEGORY_NAMES }],
  claim: [{ options: PROVIDER_INTERESTS }],
};

/** Request types that are not about a specific fund (no structure / AuM fields). */
export const NO_FUND_FIELDS: readonly RequestType[] = ["data", "awards", "claim"];
