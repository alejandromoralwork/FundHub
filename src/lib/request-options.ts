import type { RequestType } from "@/db/schema";
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

/** FundHub's buy-side advisory services (Pillar 2). */
export const ADVISORY_SERVICES = [
  {
    id: "fee-audit",
    label: "Bespoke Fee Audit",
    description:
      "We benchmark an existing or proposed fee schedule line by line against our market data, then flag hidden line items, inflated out-of-pocket expenses and services you don't need.",
  },
  {
    id: "vendor-selection",
    label: "Vendor Selection & RFP Management",
    description:
      "We build a standardized RFP, invite a balanced shortlist (boutique to institutional), normalize the answers and score them apples-to-apples.",
  },
  {
    id: "negotiation",
    label: "Negotiation & Meeting Advocacy",
    description:
      "A senior FundHub expert sits on your side of the table, in person or virtually, in pricing workshops and onboarding meetings.",
  },
  {
    id: "fund-setup",
    label: "Fund Set-up Service Map",
    description:
      "For managers new to Luxembourg: which providers your structure legally requires, realistic budgets, and a timeline. No referrals attached.",
  },
] as const;
export const ADVISORY_SERVICE_LABELS = ADVISORY_SERVICES.map((s) => s.label);

/** What a service provider can ask FundHub for. */
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
  claim: [{ options: PROVIDER_INTERESTS }],
};
