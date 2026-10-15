/** FundHub Market Awards: categories and process. */

export const AWARD_CATEGORIES = [
  { name: "Fund Administrator of the Year: Boutique", category: "fund-administration" },
  { name: "Fund Administrator of the Year: Mid-Market & Institutional", category: "fund-administration" },
  { name: "Depositary & Custody Provider of the Year", category: "depositary-banking" },
  { name: "Third-Party AIFM / ManCo of the Year", category: "aifm-manco" },
  { name: "Corporate Services & Domiciliation Provider of the Year", category: "governance-domiciliation" },
  { name: "Regulatory, Compliance & Risk Provider of the Year", category: "regulatory-compliance" },
  { name: "Tax Adviser of the Year", category: "tax" },
  { name: "Corporate Accounting Provider of the Year", category: "corporate-accounting" },
  { name: "Technology & Support Partner of the Year", category: "professional-support" },
  { name: "Rising Boutique of the Year", category: null },
  { name: "Client Service Excellence Award", category: null },
] as const;

export const AWARD_CATEGORY_NAMES = AWARD_CATEGORIES.map((a) => a.name);

export const AWARD_CRITERIA = [
  { weight: "50%", label: "Verified peer reviews", body: "Closed, double-blind ratings from authenticated asset managers." },
  { weight: "25%", label: "Independent jury", body: "Senior industry figures with no current mandate with any nominee." },
  { weight: "15%", label: "Operational data", body: "Verified data: technology, certifications, capacity and growth." },
  { weight: "10%", label: "Pricing transparency", body: "Fee clarity and alignment with market benchmarks." },
];

export const AWARD_TIMELINE = [
  { when: "Q1", what: "Nominations open: providers nominate themselves; clients can recommend providers" },
  { when: "Q2", what: "Data audit of nominees and peer-review window" },
  { when: "Q2", what: "Jury deliberation and shortlist announcement" },
  { when: "June", what: "FundHub Market Awards gala in Luxembourg" },
];
