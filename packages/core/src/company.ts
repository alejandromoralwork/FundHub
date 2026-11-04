/**
 * Legal identity shown in the legal notice, privacy policy, invoices and emails.
 * Fill in the real values before launch. Placeholders are shown as "[to be completed]".
 */

/**
 * FILE: packages/core/src/company.ts
 * PART: shared package (packages/core)
 * WHAT IT DOES: One place that stores FundHub's own company details (legal name, address, registration
 *   numbers, contact emails…). The legal pages, invoices and emails read them from here, so a change made
 *   here appears everywhere at once. Values not yet known are marked with a placeholder.
 * WHERE IT RUNS: both (server and browser). It is plain data plus one tiny function.
 * FRAMEWORK NOTES: none; plain TypeScript only.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `const` = a fixed name; `export` = available to other files via `import`.
 *   - object literal `{ key: value, … }` = a group of named values.
 *   - `as const` = makes the object read-only and keeps each exact value as its type.
 *   - arrow function `(v: string) => …` with a parameter type annotation `: string`.
 *   - `===` = strict equality ("is exactly the same value and type").
 */

/**
 * Kind: constant (a string), NOT exported, so only this file can use it.
 * The placeholder text used for every detail that is not known yet. Keeping it in one constant means
 * `isPlaceholder` (below) can recognise it reliably.
 */
const TBC = "[to be completed]";

/**
 * Kind: constant (a read-only object).
 * FundHub's legal identity. Other code reads a field with a dot, e.g. `COMPANY.contactEmail`.
 * The `// e.g. …` notes after some lines show what the real value should look like.
 * `as const` (at the end) makes every field read-only, so no code can accidentally change, say, the VAT
 * number at run time; TypeScript would refuse to compile `COMPANY.vatNumber = "x"`.
 */
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
  // Date the legal texts were last revised, written as text in ISO format (year-month-day).
  lastUpdated: "2026-10-15",
} as const;

/**
 * Kind: function (written as an arrow function stored in a constant).
 * Tells whether a company detail is still the placeholder, so pages can e.g. highlight missing details.
 * @param v  type `string` — the value to test (the `: string` after the name is the type annotation:
 *           TypeScript will refuse a call with anything that is not text).
 * @returns  `boolean` (true/false): `true` when `v` is exactly the placeholder text.
 * Syntax: `(v: string) => v === TBC` is a function that takes `v` and returns the result of `v === TBC`.
 * With an arrow function and no curly braces, the expression after `=>` is returned automatically.
 */
export const isPlaceholder = (v: string) => v === TBC;
