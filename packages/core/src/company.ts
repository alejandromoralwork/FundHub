/**
 * Legal identity shown in the legal notice, privacy policy, invoices and emails.
 * Fill in the real values before launch. Placeholders are shown as "[to be completed]".
 */
const TBC = "[to be completed]";

export const COMPANY = {
  brand: "FundHub",
  website: "https://fundhub.lu",
  legalName: TBC, // e.g. "FundHub S.à r.l."
  legalForm: TBC, // e.g. "société à responsabilité limitée"
  address: TBC, // registered office, Luxembourg
  rcsNumber: TBC, // Luxembourg Business Registers, e.g. "B 123456"
  vatNumber: TBC, // e.g. "LU12345678"
  businessPermit: TBC, // Ministry of the Economy authorisation number, if applicable
  contactEmail: "hello@fundhub.lu",
  privacyEmail: "privacy@fundhub.lu",
  director: TBC, // person responsible for the publication
  hostingProvider: "Vercel Inc., USA (website hosting); Neon Inc., USA (database, hosted on AWS)",
  lastUpdated: "2026-10-15",
} as const;

export const isPlaceholder = (v: string) => v === TBC;
