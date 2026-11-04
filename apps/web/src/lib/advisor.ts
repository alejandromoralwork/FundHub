import "server-only";
/**
 * FILE: apps/web/src/lib/advisor.ts
 * PART: website (apps/web)
 * WHAT IT DOES: The "brain" of the website's advisor chat box. Despite the name it does NOT call an AI model: it
 *   is a rule-based knowledge base. It looks for keywords in the visitor's question (e.g. "raif", "depositary"),
 *   picks the best-matching topic, and replies with a short explanation, three key points, up to three matching
 *   providers from the database, and a link to the comparison page with suitable filters already set.
 * WHERE IT RUNS: on the server only (`import "server-only"` makes the build fail if browser code imports it).
 *   It is called by the API route apps/web/src/app/api/advisor/route.ts, which the chat box talks to.
 * FRAMEWORK NOTES: none specific; this is plain TypeScript plus a shared database query (`searchProviders`).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases `type X = { … }`, optional fields `filterHref?:`, arrays `string[]`, inline object types.
 *   - `Omit<Topic, "keywords">` = "the Topic type without its keywords field".
 *   - array methods: `.reduce` (combine a list into one value), `.map`, `.filter`, `.sort`, `.slice`, `.join`.
 *   - `let` = a name that CAN be reassigned later (unlike `const`); `delete obj.key` removes a field.
 *   - type predicates `(e): e is [string, string] => …`; optional chaining `?.`; `??`; spread `{ ...obj }`.
 */

// `import { a } from "b"` loads named things from module b; `@fundhub/...` = our shared packages.
// `searchProviders` = the same provider search the comparison page uses.
import { searchProviders } from "@fundhub/db/queries";
// `parseFilters` cleans raw URL-style filters ({ category: "tax", sort: "fee" }) into the search's filter object;
// `RawSearchParams` is the type of those raw filters: an object of texts (or lists of texts).
import { parseFilters, type RawSearchParams } from "@fundhub/core/filters";

/**
 * Kind: type alias. What the advisor sends back to the chat box:
 * - `title`, `body`, `points`: the explanation (a heading, a paragraph, and a list of key points);
 * - `providers`: up to three suggested providers (each an object with these five fields; `{…}[]` = a list of them);
 * - `filterHref` (optional): a link to the comparison page with the matching filters, e.g. "/compare?reg=RAIF".
 */
export type AdvisorReply = {
  title: string;
  body: string;
  points: string[];
  providers: { slug: string; name: string; priceMin: number; priceMax: number; verified: boolean }[];
  filterHref?: string;
};

/**
 * Kind: type alias (not exported: only used in this file). One entry of the knowledge base:
 * - `keywords`: lower-case words that point to this topic;
 * - `title`, `body`, `points`: the reply text;
 * - `filters`: the comparison-page filters used to find suitable providers.
 */
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
 *
 * Kind: constant (a list of Topic objects). Every entry below has the same shape (see `Topic` above), so only
 * the shape is explained here. In `filters`, the keys match the comparison page's URL parameters:
 * `category` (service category slug), `reg` (regulatory scope), `service` (one named service),
 * `q` (free-text search) and `sort` ("score" = best FundHub Score first, "fee" = cheapest first).
 * Keywords with a trailing space (e.g. "rc ", "tp ") must be followed by a space, so "rc" does not match
 * inside words such as "source"; the question gets a space added at both ends for this reason.
 * Some keywords are deliberately cut short ("overcharg", "negotiat", "domicil") to match several word endings.
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
    filters: { reg: "RAIF", category: "fund-administration", sort: "score" },
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
    filters: { reg: "UCITS", category: "aifm-manco", sort: "score" },
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
    filters: { category: "depositary-banking", sort: "fee" },
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
    filters: { category: "regulatory-compliance", sort: "score" },
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
    filters: { category: "tax", sort: "score" },
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
    filters: { service: "FATCA & CRS Reporting" },
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
    filters: { category: "tax" },
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
    filters: { service: "Transfer Pricing Documentation" },
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
    filters: { category: "regulatory-compliance", q: "sfdr" },
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
    filters: { service: "AIFMD Annex IV Reporting" },
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
    filters: { category: "governance-domiciliation", sort: "score" },
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
    filters: { reg: "ELTIF" },
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
    filters: { service: "Independent Valuation" },
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
    filters: { category: "aifm-manco", sort: "score" },
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
  {
    keywords: ["referral", "kickback", "commission", "independent", "conflict", "recommend", "law firm"],
    title: "Avoiding referral-driven choices",
    body: "In Luxembourg, providers are often recommended by the law firm or administrator that set up your fund, sometimes under referral fees or reciprocal deals. Ask every adviser to confirm in writing that they receive no benefit from your choice. FundHub takes no referral fees or commissions.",
    points: [
      "Ask: do you receive any fee or benefit if we appoint this provider?",
      "Compare the full market, not a pre-selected shortlist",
      "Use a standardized RFI so proposals are comparable",
    ],
    filters: { sort: "score" },
  },
  {
    keywords: ["audit", "proposal", "overcharg", "negotiat", "too expensive", "hidden"],
    title: "Independent fee audit",
    body: "FundHub's advisors benchmark proposals and invoices line by line against our market data and negotiate on your behalf. We're paid by you (flat fee or share of savings), never by the provider. See /advisory.",
    points: [
      "Hidden per-SPV, per-investor and per-transaction charges",
      "Out-of-pocket and 'technology' expenses",
      "Minimum fees and indexation clauses vs. market",
    ],
    filters: { sort: "fee" },
  },
  {
    keywords: ["domicil", "registered office", "director", "corporate secretar", "rbe", "liquidation"],
    title: "Domiciliation & governance",
    body: "Every Luxembourg entity needs a registered office with a licensed domiciliation agent, board meetings held in Luxembourg for substance, and timely RCS/RBE filings.",
    points: [
      "Check the agent's licence under the Law of 31 May 1999",
      "Limit how many mandates each independent director holds",
      "Prefer a fixed annual fee per entity over hourly billing",
    ],
    filters: { category: "governance-domiciliation", sort: "score" },
  },
  {
    keywords: ["spv", "holdco", "soparfi", "bookkeeping", "consolidation", "statutory accounts"],
    title: "SPV & HoldCo accounting",
    body: "Private-markets structures hold assets through SOPARFIs and SPVs that each need bookkeeping, statutory accounts (eCDF filing) and often consolidation.",
    points: [
      "Price per entity, including eCDF filing",
      "Lux GAAP vs IFRS and consolidation capability",
      "Combine with CIT/NWT compliance to avoid double handling",
    ],
    filters: { category: "corporate-accounting", sort: "score" },
  },
];

/**
 * Kind: constant. The reply used when no topic's keywords match: it explains what the advisor can help with and
 * suggests example questions. Its type is a Topic without keywords (`Omit<…>`), since it is never matched.
 */
const FALLBACK: Omit<Topic, "keywords"> = {
  title: "How I can help",
  body: "I can guide you on Luxembourg fund structures and servicing: RAIF, UCITS, SCSp, depositary models, ManCos, domiciliation, SPV accounting, AML/MLRO, tax, SFDR, AIFMD reporting, fee benchmarking and avoiding referral-driven choices.",
  points: [
    "Try: “What do I need for a RAIF depositary?”",
    "Try: “Who handles transfer pricing for SPVs?”",
    "Try: “Is my administration proposal too expensive?”",
  ],
  filters: { sort: "score" },
};

/**
 * Kind: constant. Fund-administration software names (lower case) the advisor recognises in a question. If one is
 * mentioned, suggested providers are limited to those using that software.
 */
const STACKS = ["efront", "yardi", "investran", "paxus", "multifonds", "allvue"];

/**
 * Kind: function.
 * @param text  type `string` — the visitor's question, lower-cased, with a space at each end.
 * @param t     type `Topic` — one knowledge-base topic.
 * @returns     `number` (inferred): how well the topic matches; 0 = not at all.
 * How: `.reduce` walks through the keywords carrying a running total `s` that starts at 0. For each keyword `k`
 * found in the text, it adds the keyword's length, so longer (more specific) matches count for more.
 */
function scoreTopic(text: string, t: Topic) {
  return t.keywords.reduce((s, k) => (text.includes(k) ? s + k.length : s), 0);
}

/**
 * Kind: async function (exported; used by the advisor API route).
 * @param question  type `string` — what the visitor typed into the chat box.
 * @returns         `Promise<AdvisorReply>`: the answer to show (arrives later because it queries the database).
 */
export async function answerAdvisorQuestion(question: string): Promise<AdvisorReply> {
  // Lower-case for easy matching; the spaces at both ends let keywords like "rc " match at the very end too.
  const text = ` ${question.toLowerCase()} `;
  // Rank the topics: `.map` pairs each topic `t` with its score `s`; `.filter` drops non-matches; `.sort` puts
  // the highest score first (`b.s - a.s` = descending); `[0]?.t` = the top topic, or `undefined` if none matched.
  const best = TOPICS.map((t) => ({ t, s: scoreTopic(text, t) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)[0]?.t;
  // No match → use the general "How I can help" reply.
  const topic = best ?? FALLBACK;

  // Respect any tech stack mentioned in the question.
  // `{ ...topic.filters }` makes a COPY, so changing `filters` below never alters the shared TOPICS data.
  const filters: RawSearchParams = { ...topic.filters };
  // Find mentioned software names and write them as the comparison page expects: "eFront" is a special case,
  // others get a capital first letter (`s[0]!.toUpperCase()` + the rest of the word, `s.slice(1)`).
  const stacks = STACKS.filter((s) => text.includes(s)).map((s) =>
    s === "efront" ? "eFront" : s[0]!.toUpperCase() + s.slice(1),
  );
  // Several names become one comma-separated filter, e.g. "Yardi,Paxus".
  if (stacks.length) filters.stack = stacks.join(",");

  // `let` because `matches` may be replaced by a second search below.
  let matches = await searchProviders(parseFilters(filters));
  // A free-text term can be too narrow; fall back to the structured filters.
  if (!matches.length && filters.q) {
    // Copy the filters without `q` (`q: _q` takes it out under an unused name; `...rest` keeps the others).
    const { q: _q, ...rest } = filters;
    matches = await searchProviders(parseFilters(rest));
    // Also drop `q` from the link we give the visitor, so the comparison page shows the same results.
    delete filters.q;
  }

  // Turn the filters into URL query text, e.g. "category=tax&sort=fee". The `.filter` keeps only pairs whose
  // value is non-empty text; the `e is [string, string]` part tells TypeScript that is now guaranteed.
  const qs = new URLSearchParams(
    Object.entries(filters).filter((e): e is [string, string] => typeof e[1] === "string" && !!e[1]),
  ).toString();

  // Build the reply. `.slice(0, 3)` = at most three providers; `.map` keeps only the fields the chat box shows.
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
    filterHref: qs ? `/compare?${qs}` : "/compare",
  };
}
