export type InsightSection = { heading?: string; paragraphs?: string[]; bullets?: string[] };

export type Insight = {
  slug: string;
  title: string;
  summary: string;
  topic: "Independence" | "Fees" | "Structuring" | "Depositary";
  published: string; // ISO date
  readMinutes: number;
  /** Taxonomy category the article relates to, for cross-links. */
  category?: string;
  sections: InsightSection[];
};

export const INSIGHTS: Insight[] = [
  {
    slug: "referral-fees-luxembourg-fund-services",
    title: "How referral fees shape provider selection in Luxembourg",
    summary:
      "Most fund managers arriving in Luxembourg choose their administrator, depositary and ManCo on the recommendation of whoever set up the fund. Here is why that's a problem, and how to run a conflict-free selection.",
    topic: "Independence",
    published: "2026-09-15",
    readMinutes: 6,
    sections: [
      {
        paragraphs: [
          "Luxembourg is Europe's largest fund domicile, yet there is almost no public information on who the service providers are, what they charge and how well they deliver. International managers therefore lean on the law firm, tax adviser or consultant handling their fund set-up to recommend the rest of the service chain.",
          "Those recommendations are rarely neutral. Introductions between gatekeepers and service providers often run on pre-agreed referral fees, commission arrangements or reciprocal business: 'you send us the fund administration, we send you the next structuring mandate'.",
        ],
      },
      {
        heading: "What a referral loop costs you",
        bullets: [
          "A shortlist of two or three 'trusted' names instead of the 30+ providers active in each category",
          "No price tension: providers who receive referred mandates rarely compete on price",
          "Specialised boutiques, often cheaper and more senior, never get a chance to quote",
          "Weak negotiating position: you don't know the market rate, and your adviser has no incentive to tell you",
        ],
      },
      {
        heading: "Questions to ask any adviser who recommends a provider",
        bullets: [
          "Do you or your firm receive any fee, commission or benefit if we appoint this provider?",
          "Do you have a reciprocal referral relationship with them?",
          "Which other providers did you consider, and why were they excluded?",
          "Can you share the fee benchmarks your recommendation is based on?",
        ],
      },
      {
        heading: "How FundHub avoids the conflict",
        paragraphs: [
          "FundHub is paid by the buyer: fund managers pay for our advisory work through a flat fee or a share of the savings we capture. We accept no referral fees or commissions from providers. Provider subscriptions only give them control over their profile data. They can't buy ranking, scores or the Verified badge.",
        ],
      },
    ],
  },
  {
    slug: "hidden-line-items-fund-administration-proposals",
    title: "7 hidden line items in fund administration proposals",
    summary:
      "Headline fees rarely tell the full story. These are the line items our fee audits most often find buried in central-administration proposals for private-markets funds.",
    topic: "Fees",
    published: "2026-08-28",
    readMinutes: 5,
    category: "fund-administration",
    sections: [
      {
        paragraphs: [
          "Administrators structure proposals in bespoke formats, which makes like-for-like comparison almost impossible. Before you sign, check for these items:",
        ],
      },
      {
        bullets: [
          "Per-SPV accounting fees: the headline fee covers the fund but not its holding and asset SPVs",
          "Investor-transaction charges: per capital call, distribution or transfer, which add up quickly with many LPs",
          "Annual-accounts drafting billed separately, often at hourly rates",
          "Regulatory reporting add-ons: Annex IV, BCL statistics, FATCA/CRS filings priced per report",
          "Out-of-pocket expenses: postage, bank charges and 'technology fees' charged as a percentage of the fee",
          "Minimum fees that apply per sub-fund rather than per umbrella",
          "Indexation clauses that raise fees automatically each year above inflation",
        ],
      },
      {
        heading: "How to compare proposals properly",
        paragraphs: [
          "Normalize every proposal to the same scope: same NAV frequency, same number of investors, SPVs and transactions. Then compare the total annual cost, not the headline fee. FundHub's standardized RFI does this by design, and our fee audit does it for proposals you already hold.",
        ],
      },
    ],
  },
  {
    slug: "depositary-lite-vs-full-depositary",
    title: "Depositary-lite vs full depositary: which does your fund need?",
    summary:
      "For illiquid AIFs, a professional depositary (PSF) can perform AIFMD Art. 21 duties at a fraction of a bank's cost. Here is how to decide.",
    topic: "Depositary",
    published: "2026-07-10",
    readMinutes: 4,
    category: "depositary-banking",
    sections: [
      {
        paragraphs: [
          "UCITS must appoint a credit institution as depositary. AIFs investing mainly in assets that cannot be held in custody (private equity, real estate, infrastructure) can instead appoint a professional depositary of assets other than financial instruments, a specialised PSF. This is often called 'depositary-lite'.",
        ],
      },
      {
        heading: "What stays the same",
        bullets: [
          "Ownership verification and record-keeping of the fund's assets",
          "Cash-flow monitoring of the fund's bank accounts",
          "Oversight duties: NAV calculation, subscriptions/redemptions, distribution of income",
        ],
      },
      {
        heading: "What to compare",
        bullets: [
          "Fee model: bps on NAV with a minimum fee vs flat fee",
          "Transaction charges: often irrelevant for illiquid funds but still quoted by banks",
          "Bundling: depositaries bundled with the administrator can hide a premium",
          "Experience with your asset class and your administrator's systems",
        ],
      },
    ],
  },
  {
    slug: "raif-setup-service-providers",
    title: "Setting up a RAIF: the service providers you actually need",
    summary:
      "A RAIF isn't supervised by the CSSF, but its service chain is. This is the minimum set of providers, what each one does and the order to appoint them in.",
    topic: "Structuring",
    published: "2026-06-02",
    readMinutes: 6,
    category: "aifm-manco",
    sections: [
      {
        heading: "Mandatory",
        bullets: [
          "An authorised AIFM: your own, or a third-party ('super') ManCo",
          "A depositary: a bank, or a depositary-lite PSF for illiquid strategies",
          "A central administrator: NAV, fund accounting, investor register",
          "An approved statutory auditor (réviseur d'entreprises agréé)",
        ],
      },
      {
        heading: "Usually needed",
        bullets: [
          "Domiciliation agent and corporate secretarial for the fund and its SPVs",
          "Independent directors or managers for substance",
          "Tax adviser for SPV structuring, transfer pricing and VAT",
          "AML/KYC and RC/MLRO support if the AIFM delegates them",
        ],
      },
      {
        heading: "Order of appointment",
        paragraphs: [
          "Choose the AIFM first, since it drives the rest of the chain. Then run a single, standardized RFI for administration and depositary together, so the proposals can be compared. Appoint legal counsel for documentation, but don't let the same firm choose your service providers unless it confirms in writing that it receives no referral benefits.",
        ],
      },
    ],
  },
];

export function getInsight(slug: string) {
  return INSIGHTS.find((i) => i.slug === slug);
}
