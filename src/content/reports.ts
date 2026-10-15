import type { ReportVisibility } from "@/db/schema";

/** Reports generated on demand from live platform data (see src/lib/report-pdf.ts). */
export type BuiltInReport = {
  slug: "market-snapshot" | "provider-intelligence";
  title: string;
  summary: string;
  visibility: ReportVisibility;
  contents: string[];
};

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

export function currentQuarter(d = new Date()): string {
  return `Q${Math.floor(d.getMonth() / 3) + 1} ${d.getFullYear()}`;
}
