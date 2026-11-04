/**
 * FILE: packages/core/src/request-options.ts
 * PART: shared package (packages/core)
 * WHAT IT DOES: The choices offered in FundHub's enquiry forms (request for quotes, advisory, data, awards):
 *   fund structures, assets-under-management (AuM) bands, FundHub's advisory and data services, and which
 *   "services needed" options each request type may contain. The website shows these options and the server
 *   checks submitted values against the same lists, so both always agree.
 * WHERE IT RUNS: both (server and browser); plain data.
 * FRAMEWORK NOTES: none.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type { X }`: import only a type (it is erased when the code runs, so no code is loaded).
 *   - `as const`, `keyof typeof`, tuple types `[A, ...A[]]`, type assertions `as`.
 *   - object types `{ label?: string; options: readonly string[] }`, where `?` marks an optional property.
 *   - `Record<K, V>`; `.map` with an arrow function returning an object `(c) => ({ … })`.
 */

// The list of award names, for the awards enquiry form.
import { AWARD_CATEGORY_NAMES } from "./awards";
// `import type`: only the TypeScript type RequestType ("rfi" | "advisory" | …) is needed, not a value.
import type { RequestType } from "./enums";
// The service categories and their sub-services, for the "request quotes" form.
import { TAXONOMY } from "./taxonomy";

/**
 * Kind: constant (read-only list). Legal forms of Luxembourg funds and holding vehicles a client can pick
 * as "fund structure", plus "Not yet decided" and "Other".
 */
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
// The keys (left) are what is saved in the database and sent by the form; they use only plain ASCII characters
// (no "€" or "<") so they survive any encoding. The values (right) are the nicer labels shown to people.
export const AUM_BAND_LABELS = {
  "lt-100m": "< €100m",
  "100m-250m": "€100m – €250m",
  "250m-1bn": "€250m – €1bn",
  "1bn-5bn": "€1bn – €5bn",
  "gt-5bn": "> €5bn",
} as const;
/** Kind: type alias. One stored AuM band: "lt-100m" | "100m-250m" | … (`keyof typeof` = the key names). */
export type AumBand = keyof typeof AUM_BAND_LABELS;
/**
 * Kind: constant. The stored band values as a list, in order. `Object.keys` returns a plain `string[]`, so
 * `as [AumBand, ...AumBand[]]` asserts the exact type: a non-empty list of AumBand values. Zod's `z.enum`
 * (used to validate form posts) requires exactly that shape.
 */
export const AUM_BANDS = Object.keys(AUM_BAND_LABELS) as [AumBand, ...AumBand[]];

/** Fund Set-up & Provider Fee Negotiation Advisory: the services FundHub sells to clients. */
// Each item: `id` (stable internal name), `label` (shown in the form and stored with the request) and
// `description` (longer text shown on the advisory page).
export const ADVISORY_SERVICES = [
  {
    id: "negotiation",
    label: "Provider Fee Negotiation (at the table with you)",
    description:
      "A senior FundHub expert comes with you, in person or virtually, to pricing meetings with service providers and negotiates on your side of the table using our market data.",
  },
  {
    id: "fund-setup",
    label: "Fund & Activity Set-up in Luxembourg",
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
/** Kind: constant. Just the labels of the advisory services (`.map` makes a new list with one label per item). */
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
// Still listed so that old "claim" requests already in the database remain valid (see REQUEST_TYPES in enums.ts).
export const PROVIDER_INTERESTS = [
  "Claim / correct my free profile",
  "Pro account (profile control)",
  "Data verification (free)",
  "Quarterly intelligence reports",
  "FundHub Market Awards",
] as const;

/**
 * Kind: type alias for an object type. One group of check-boxes in the "services needed" part of a form.
 * - `label?: string` — optional heading of the group (the `?` means the property may be left out).
 * - `options: readonly string[]` — the choices in the group (a list that may not be modified).
 * In an object type, properties are separated by `;`.
 */
export type ServiceGroup = { label?: string; options: readonly string[] };

/** Allowed `servicesNeeded` values per request type. */
// `Record<RequestType, ServiceGroup[]>` = an object with one entry for EVERY request type, each a list of groups.
// TypeScript will complain if a request type is missing here, so new request types cannot be forgotten.
export const SERVICE_GROUPS: Record<RequestType, ServiceGroup[]> = {
  // For quote requests: one group per service category, headed by the category name.
  // `(c) => ({ … })`: the round brackets around `{ … }` mean "return this object"; without them the curly braces
  // would be read as the body of the function.
  rfi: TAXONOMY.map((c) => ({ label: c.label, options: c.services })),
  // The other request types have a single group with no heading.
  advisory: [{ options: ADVISORY_SERVICE_LABELS }],
  data: [{ options: DATA_SERVICES }],
  awards: [{ options: AWARD_CATEGORY_NAMES }],
  claim: [{ options: PROVIDER_INTERESTS }],
};

/** Request types that are not about a specific fund (no structure / AuM fields). */
// `readonly RequestType[]`: a list of request types that may not be modified. Forms hide the fund-structure and
// AuM questions when the request type is in this list.
export const NO_FUND_FIELDS: readonly RequestType[] = ["data", "awards", "claim"];
