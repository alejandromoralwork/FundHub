/**
 * FILE: apps/web/src/content/reports.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Lists the two built-in reports FundHub offers on the Data Intelligence pages (title, summary,
 *   who may download it, table of contents), plus a helper that names the current quarter, e.g. "Q4 2026".
 *   The PDFs themselves are generated on demand from live data by src/lib/report-pdf.ts.
 * WHERE IT RUNS: both — it is plain data and a small function, usable by server and browser code.
 * FRAMEWORK NOTES: files in src/content/ hold fixed website content as TypeScript data instead of in the database.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type` = import only a type; type aliases `type X = { … }` describing the shape of an object.
 *   - string literal union `"market-snapshot" | "provider-intelligence"` = only these exact texts are allowed.
 *   - `string[]` = a list of texts; `BuiltInReport[]` = a list of reports.
 *   - default parameter `d = new Date()` = "use the current date if none is given".
 */

// `ReportVisibility` = the type `"public" | "private"`, defined once in our shared packages (re-exported by
// @fundhub/db/schema) so the database and the website agree.
import type { ReportVisibility } from "@fundhub/db/schema";

/**
 * Reports generated on demand from live platform data (see src/lib/report-pdf.ts).
 * Kind: type alias. Fields:
 * - `slug`: the report's URL name; only the two listed values are allowed.
 * - `title`, `summary`: text shown on the website.
 * - `visibility`: "public" (anyone) or "private" (members and approved providers only).
 * - `contents`: the report's section headings, shown as a list.
 */
export type BuiltInReport = {
  slug: "market-snapshot" | "provider-intelligence";
  title: string;
  summary: string;
  visibility: ReportVisibility;
  contents: string[];
};

/**
 * Kind: constant (an array of BuiltInReport objects). The annotation `: BuiltInReport[]` makes TypeScript check
 * that every entry has exactly the right fields. Each `{ … }` below is one report.
 */
export const BUILT_IN_REPORTS: BuiltInReport[] = [
  {
    slug: "market-snapshot",
    title: "Luxembourg Fund Services Market Snapshot",
    summary:
      "A free quarterly overview of the indexed market: provider counts and typical fee ranges by service category and provider size.",
    visibility: "public",
    contents: ["Market overview", "Typical quarterly fees by category", "Fees by provider size"],
  },
  {
    slug: "provider-intelligence",
    title: "Provider Intelligence Report",
    summary:
      "For approved provider accounts: fee distribution, buyer demand from RFIs, software penetration, licence and asset-class coverage across the market.",
    visibility: "private",
    contents: [
      "Local fee distribution by category",
      "Most requested services (RFI demand)",
      "Software penetration",
      "Licence and asset-class coverage",
    ],
  },
];

/**
 * Kind: function.
 * @param d  type `Date` (inferred from the default), default: now — the date to describe.
 * @returns  `string`: the quarter label, e.g. "Q4 2026".
 * How: `getMonth()` gives 0 for January … 11 for December. Dividing by 3 and rounding down (`Math.floor`)
 * gives 0–3; adding 1 gives the quarter number 1–4.
 */
export function currentQuarter(d = new Date()): string {
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}
