/** FundHub Market Awards: categories and process. */

/**
 * FILE: packages/core/src/awards.ts
 * PART: shared package (packages/core)
 * WHAT IT DOES: Holds the fixed facts about the FundHub Market Awards: the list of award categories, how
 *   nominees are judged (criteria and weights) and the yearly timeline. It contains only data, no logic.
 *   The website shows these on the awards page, and the request forms offer the category names as options.
 * WHERE IT RUNS: both. It is plain data, so any code (server or browser) can import it safely.
 * FRAMEWORK NOTES: none; this file uses only plain TypeScript.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `export` = makes a value visible to other files, which can then `import` it.
 *   - `const` = a name whose value is fixed once set (it can never be reassigned).
 *   - array literals `[ … ]` and object literals `{ key: value }`.
 *   - `as const` = "freeze this value and remember its exact contents as its type".
 *   - `.map((a) => a.name)` = an arrow function applied to every item of an array.
 *   - `null` = a deliberate "no value".
 */

/**
 * Kind: constant (an exported, read-only array of objects).
 * The 11 award categories. Each item is an object with two properties:
 * - `name`: the award title shown to people.
 * - `category`: the slug (URL-friendly id, e.g. "tax") of the service category from taxonomy.ts that the award
 *   belongs to, or `null` when the award is open to every kind of provider (cross-category awards).
 *
 * Why `as const` at the end: without it TypeScript would only remember "an array of objects whose `name` is
 * some string". With it, TypeScript treats the array as read-only (no adding or changing items) and records
 * each exact text, e.g. the type of `name` becomes the literal "Tax Adviser of the Year" and not just `string`.
 * That lets other code be checked against the exact list of allowed names.
 */
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
  // The last two awards are not tied to one service category, so `category` is `null`.
  { name: "Rising Boutique of the Year", category: null },
  { name: "Client Service Excellence Award", category: null },
] as const;

/**
 * Kind: constant (an array of strings).
 * Just the award names, e.g. ["Fund Administrator of the Year: Boutique", …].
 * `.map(fn)` runs `fn` on every item of an array and returns a NEW array of the results (same length).
 * `(a) => a.name` is an arrow function: it takes one parameter `a` (one award object) and returns `a.name`.
 * TypeScript works out the type of `a` by itself from the array, so no type needs to be written here.
 * Used by request-options.ts to list the awards as choices in the awards enquiry form.
 */
export const AWARD_CATEGORY_NAMES = AWARD_CATEGORIES.map((a) => a.name);

/**
 * Kind: constant (an array of objects).
 * How the winners are chosen. Each item: `weight` (share of the final result, as display text),
 * `label` (short title) and `body` (one-sentence explanation). The four weights add up to 100%.
 * No `as const` here because no other code needs the exact texts as types; it is only displayed.
 */
export const AWARD_CRITERIA = [
  { weight: "50%", label: "Verified peer reviews", body: "Closed, double-blind ratings from authenticated asset managers." },
  { weight: "25%", label: "Independent jury", body: "Senior industry figures with no current mandate with any nominee." },
  { weight: "15%", label: "Operational data", body: "Verified data: technology, certifications, capacity and growth." },
  { weight: "10%", label: "Pricing transparency", body: "Fee clarity and alignment with market benchmarks." },
];

/**
 * Kind: constant (an array of objects).
 * The yearly awards calendar shown on the awards page, in order. Each item: `when` (the period)
 * and `what` (what happens then).
 */
export const AWARD_TIMELINE = [
  { when: "Q1", what: "Nominations open: providers nominate themselves; clients can recommend providers" },
  { when: "Q2", what: "Data audit of nominees and peer-review window" },
  { when: "Q2", what: "Jury deliberation and shortlist announcement" },
  { when: "June", what: "FundHub Market Awards gala in Luxembourg" },
];
