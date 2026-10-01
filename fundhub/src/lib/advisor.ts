import "server-only";
import { searchProviders } from "@/db/queries";
import { parseFilters, type RawSearchParams } from "./filters";

export type AdvisorReply = {
  title: string;
  body: string;
  points: string[];
  providers: { slug: string; name: string; priceMin: number; priceMax: number; verified: boolean }[];
  filterHref?: string;
};

type Topic = {
  keywords: string[];
  title: string;
  body: string;
  points: string[];
  /** Comparator filters used to suggest providers. */
  filters: RawSearchParams;
};

/**
 * Rule-based knowledge base for common Luxembourg fund-servicing questions.
 * Guidance is general information, not legal or tax advice.
 */
const TOPICS: Topic[] = [
  {
    keywords: ["raif", "reserved alternative"],
    title: "RAIF set-up checklist",
    body: "A RAIF is not CSSF-supervised itself, but must appoint an authorised AIFM, a depositary and a central administrator in Luxembourg. Bundle depositary and central admin under one SLA where possible.",
    points: [
      "AIFMD Art. 21 depositary duties — full vs. depositary-lite for illiquid assets",
      "NAV frequency and cut-off (quarterly NAV is typical for closed-ended RAIFs)",
      "Notarial deed + registration with RCS within 5 days; listing on the RAIF list",
    ],
    filters: { reg: "RAIF", sort: "score" },
  },
  {
    keywords: ["ucits", "sicav", "kiid", "kid", "priips"],
    title: "UCITS servicing scope",
    body: "UCITS require a full depositary with custody, cash monitoring and oversight duties under UCITS V, plus daily or weekly NAV and a PRIIPs KID for retail share classes.",
    points: [
      "Depositary liability for loss of financial instruments held in custody",
      "Transfer agency with distributor oversight and AML/KYC on investors",
      "Subscription tax at 0.05% p.a. (0.01% for institutional classes)",
    ],
    filters: { reg: "UCITS", sort: "score" },
  },
  {
    keywords: ["depositary", "custody", "custodian", "art. 21", "article 21"],
    title: "Choosing a depositary",
    body: "For illiquid strategies (PE, RE, infra), a depositary-lite model focusing on ownership verification and cash-flow monitoring is usually more cost-effective than full custody.",
    points: [
      "Ownership verification process for non-custodial assets",
      "Cash-flow monitoring frequency and escalation process",
      "Liability regime and any discharge via contract",
    ],
    filters: { q: "depositary", sort: "fee" },
  },
  {
    keywords: ["aml", "kyc", "mlro", "anti-money", "18/698", "rc ", "compliance officer"],
    title: "AML/KYC & MLRO outsourcing",
    body: "Under CSSF Circular 18/698 and the 2004 AML Law, investment fund managers must appoint an RC (compliance officer) and an MLRO. Many emerging managers outsource these functions while keeping oversight in-house.",
    points: [
      "Risk-based investor due diligence and ongoing screening (PEP/sanctions)",
      "Annual AML/CFT questionnaire and reporting to the CSSF",
      "Board-level oversight of delegated AML functions",
    ],
    filters: { category: "Compliance", sort: "score" },
  },
  {
    keywords: ["subscription tax", "taxe d'abonnement", "tax d'abonnement"],
    title: "Subscription tax (taxe d'abonnement)",
    body: "Luxembourg UCIs, SIFs and RAIFs pay an annual subscription tax on net assets, computed and paid quarterly. RAIFs investing in risk capital (SICAR-like regime) can be exempt.",
    points: [
      "Standard rate 0.05% p.a.; 0.01% for institutional classes, SIFs and RAIFs",
      "Exemptions for money-market, pension pooling and certain ESG/ELTIF products",
      "Reduced rates for UCITS investing in sustainable activities (Taxonomy-aligned)",
    ],
    filters: { category: "Tax", sort: "score" },
  },
  {
    keywords: ["fatca", "crs"],
    title: "FATCA & CRS reporting",
    body: "Luxembourg funds are Reporting Financial Institutions under FATCA and CRS. Annual reporting to the ACD is due by 30 June for the previous calendar year.",
    points: [
      "Investor self-certification at onboarding",
      "Annual XML filing to the Administration des Contributions Directes",
      "CRS policies and procedures + annual compliance review",
    ],
    filters: { category: "Tax", q: "fatca" },
  },
  {
    keywords: ["dac6", "mandatory disclosure"],
    title: "DAC6 reportable arrangements",
    body: "Cross-border arrangements meeting one or more DAC6 hallmarks must be reported within 30 days. Fund structuring and SPV financing often need a hallmark assessment.",
    points: [
      "Hallmark analysis (main benefit test for category A, B and C1(b)(i), C1(c), C1(d))",
      "Intermediary vs. taxpayer reporting obligations",
      "Documented assessment retained even when not reportable",
    ],
    filters: { category: "Tax", q: "dac6" },
  },
  {
    keywords: ["atad", "interest limitation", "hybrid", "transfer pricing", "tp "],
    title: "ATAD & transfer pricing for fund SPVs",
    body: "Luxembourg SPVs financed with intra-group debt must consider ATAD interest-limitation rules (30% EBITDA, €3m safe harbour), anti-hybrid rules and arm's-length TP documentation.",
    points: [
      "Interest-limitation computation and carry-forward tracking",
      "Transfer-pricing report for shareholder loans and profit-participating loans",
      "Reverse-hybrid rules for transparent partnerships (SCSp) since 2022",
    ],
    filters: { q: "transfer pricing", category: "Tax" },
  },
  {
    keywords: ["sfdr", "esg", "article 8", "article 9", "taxonomy"],
    title: "SFDR disclosures",
    body: "Article 8 and 9 funds need pre-contractual (Annex II/III) and periodic (Annex IV/V) templates, plus website disclosures and PAI statements at manager level.",
    points: [
      "Consistency between prospectus, website and periodic reports",
      "Data sourcing for PAIs and taxonomy alignment",
      "ESMA fund-naming guidelines (80% threshold for ESG terms)",
    ],
    filters: { q: "sfdr" },
  },
  {
    keywords: ["annex iv", "aifmd reporting", "aifmd ii", "aifmd"],
    title: "AIFMD reporting & AIFMD II",
    body: "AIFMs file Annex IV reports to the CSSF (quarterly, semi-annual or annual by AuM). AIFMD II (applicable from April 2026) adds loan-origination rules, liquidity-tool requirements and enhanced delegation reporting.",
    points: [
      "Annex IV frequency based on AuM and leverage",
      "Liquidity management tools for open-ended AIFs (at least two from Annex V)",
      "Loan-origination leverage caps and risk-retention rules",
    ],
    filters: { reg: "AIFMD", q: "annex iv" },
  },
  {
    keywords: ["scsp", "scs", "partnership", "lpa", "fund formation", "launch", "set up a fund", "structuring"],
    title: "Fund formation in Luxembourg",
    body: "The SCSp (special limited partnership) is the most common vehicle for private-markets funds: tax transparent, no minimum capital and a flexible LPA. It can be unregulated, a RAIF, or a SIF.",
    points: [
      "Choose AIFM: own authorised AIFM vs. third-party AIFM",
      "LPA, side-letter management and MFN process",
      "Typical launch timeline: 8–12 weeks for a RAIF SCSp",
    ],
    filters: { category: "Legal", sort: "score" },
  },
  {
    keywords: ["eltif"],
    title: "ELTIF 2.0",
    body: "ELTIF 2.0 (since January 2024) removes the €10m minimum for retail investors, widens eligible assets and allows fund-of-funds and semi-liquid structures.",
    points: [
      "CSSF authorisation of the ELTIF and its manager",
      "Redemption gates and liquidity pocket design",
      "Retail suitability and marketing rules",
    ],
    filters: { q: "eltif" },
  },
  {
    keywords: ["valuation", "nav", "level 3", "risk management", "stress test"],
    title: "Valuation & risk function",
    body: "AIFMD Art. 19 requires a functionally independent valuation; Art. 15 requires permanent risk management. Many managers appoint an external valuer for Level 3 assets.",
    points: [
      "Valuation policy approved by the board, reviewed annually",
      "Independent valuer liability and professional indemnity insurance",
      "Liquidity stress testing per ESMA guidelines",
    ],
    filters: { q: "valuation" },
  },
  {
    keywords: ["manco", "aifm", "third-party", "substance", "conducting officer"],
    title: "Third-party AIFM / ManCo",
    body: "A third-party (super) ManCo provides the regulatory licence and substance, while portfolio management is delegated back to the sponsor.",
    points: [
      "Delegation oversight and due diligence on the portfolio manager",
      "At least two conducting officers resident or present in Luxembourg",
      "Fee models: bps of AuM with a minimum annual fee",
    ],
    filters: { q: "aifm" },
  },
  {
    keywords: ["fee", "price", "cost", "cheap", "budget", "quote", "how much"],
    title: "Benchmarking fees",
    body: "Fees scale with mandate complexity (NAV frequency, number of investors, SPV count) more than AuM. Compare midpoints within the same category and provider type.",
    points: [
      "Ask for a fee grid by NAV frequency and investor count",
      "Clarify set-up fees and out-of-pocket expenses (excluded from ranges here)",
      "Use the Fee Benchmarks page to see typical ranges by category",
    ],
    filters: { sort: "fee" },
  },
];

const FALLBACK: Omit<Topic, "keywords"> = {
  title: "How I can help",
  body: "I can guide you on Luxembourg fund structures and servicing: RAIF, UCITS, SCSp, depositary models, AML/MLRO, subscription tax, FATCA/CRS, DAC6, ATAD, SFDR, AIFMD reporting and fee benchmarking.",
  points: [
    "Try: “What do I need for a RAIF depositary?”",
    "Try: “Who handles transfer pricing for SPVs?”",
    "Try: “Cheapest compliance providers using eFront”",
  ],
  filters: { sort: "score" },
};

const STACKS = ["efront", "yardi", "investran", "paxus"];

function scoreTopic(text: string, t: Topic) {
  return t.keywords.reduce((s, k) => (text.includes(k) ? s + k.length : s), 0);
}

export async function answerAdvisorQuestion(question: string): Promise<AdvisorReply> {
  const text = ` ${question.toLowerCase()} `;
  const best = TOPICS.map((t) => ({ t, s: scoreTopic(text, t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)[0]?.t;
  const topic = best ?? FALLBACK;

  // Respect any tech stack mentioned in the question.
  const filters: RawSearchParams = { ...topic.filters };
  const stacks = STACKS.filter((s) => text.includes(s)).map((s) =>
    s === "efront" ? "eFront" : s[0]!.toUpperCase() + s.slice(1),
  );
  if (stacks.length) filters.stack = stacks.join(",");

  let matches = await searchProviders(parseFilters(filters));
  // A free-text term can be too narrow; fall back to the structured filters.
  if (!matches.length && filters.q) {
    const { q: _q, ...rest } = filters;
    matches = await searchProviders(parseFilters(rest));
    delete filters.q;
  }

  const qs = new URLSearchParams(
    Object.entries(filters).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1]),
  ).toString();

  return {
    title: topic.title,
    body: topic.body,
    points: topic.points,
    providers: matches.slice(0, 3).map((p) => ({
      slug: p.slug,
      name: p.name,
      priceMin: p.priceMin,
      priceMax: p.priceMax,
      verified: p.verified,
    })),
    filterHref: qs ? `/?${qs}` : "/",
  };
}
