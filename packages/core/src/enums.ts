/** Shared enumerations used by the website, the admin platform, the database schema and the scraper. */

/**
 * FILE: packages/core/src/enums.ts
 * PART: shared package (packages/core)
 * WHAT IT DOES: Lists every fixed set of allowed values used in FundHub: provider types, statuses of
 *   requests, staff roles, expense categories, VAT rates and so on. The database schema (packages/db) uses
 *   these lists to define which values a column may hold, the forms use them to build drop-downs, and
 *   TypeScript uses them to check that code never stores a misspelt value.
 * WHERE IT RUNS: both (server and browser). It is plain data.
 * FRAMEWORK NOTES: none; plain TypeScript only. ("Enumeration" or "enum" = a closed list of allowed values.)
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `as const` on an array: makes it a read-only "tuple" and keeps each exact text as its type.
 *   - `type X = …` (a type alias): gives a name to a type. Types exist only while checking the code;
 *     they disappear when the code runs.
 *   - `typeof SOME_VALUE`: "the type of this value" (turns a value into a type).
 *   - `(typeof LIST)[number]`: "the type of any item of LIST", which here gives a union type.
 *   - union types `"a" | "b" | "c"`: "one of these exact values".
 *   - `Record<K, V>`: an object whose keys are of type K and whose values are of type V.
 *   - spread `[...A, "x"]`: a new array with all items of A followed by "x".
 */

// HOW THE PATTERN WORKS (it repeats all through this file):
//   export const PROVIDER_TYPES = ["Boutique", "Mid-Market", "Institutional"] as const;
//   export type ProviderType = (typeof PROVIDER_TYPES)[number];
// 1. The `const` is a real value that exists when the program runs: forms can loop over it to show options,
//    and the database schema can read it.
// 2. `as const` tells TypeScript to remember the exact texts. Without it the type would be just `string[]`.
// 3. The `type` line derives a union type from the array: ProviderType = "Boutique" | "Mid-Market" | "Institutional".
//    `[number]` means "look up what is at any numeric position", i.e. the type of any item.
// The list is written once and both the value and the type come from it, so they can never disagree.

/** Kind: constant (read-only list). Size bands of a service provider, from small to large. */
export const PROVIDER_TYPES = ["Boutique", "Mid-Market", "Institutional"] as const;
/** Kind: constant. Fund-accounting software platforms a provider may use (filterable on the comparator). */
export const TECH_STACKS = ["eFront", "Investran", "Yardi", "Multifonds", "Paxus", "Allvue", "Sage"] as const;
/** Kind: constant. Luxembourg/EU regulatory regimes and fund types a provider can service. */
export const REGULATORY_SCOPES = ["AIFMD", "UCITS", "RAIF", "SIF", "SICAR", "ELTIF", "Securitisation"] as const;
/** Kind: constant. Investment asset classes a provider has experience with. */
export const ASSET_CLASSES = [
  "Private Equity",
  "Real Estate",
  "Private Debt",
  "Infrastructure",
  "Venture Capital",
  "Liquid / UCITS",
] as const;
/** Kind: constant. Official Luxembourg licences / professional statuses a provider can hold. */
export const LICENCES = [
  "Authorised AIFM",
  "Chapter 15 ManCo",
  "Credit institution",
  "Specialised PSF",
  "Support PSF",
  "Domiciliation agent",
  "Chartered accountant (OEC)",
  "Réviseur d'entreprises",
] as const;
/** Kind: constant. Independent audit/security certifications a provider can hold. */
export const CERTIFICATIONS = ["ISAE 3402", "SOC 1 Type II", "SOC 2 Type II", "ISO 27001"] as const;
/**
 * Kind: constant. Life cycle of a provider profile: "staged" (imported, not yet visible), "published"
 * (shown on the website) or "archived" (hidden but kept).
 */
export const PROVIDER_STATUSES = ["staged", "published", "archived"] as const;
/** Workflow of inbound form submissions, managed in the admin platform. */
export const RFI_STATUSES = ["open", "in_progress", "responded", "closed"] as const;
/** "claim" is legacy (pre-accounts provider contact); kept so stored rows stay valid. */
// The other types: "rfi" = request for information/quotes to providers, "advisory" = FundHub advisory services,
// "data" = bespoke Data Intelligence, "awards" = awards enquiry.
export const REQUEST_TYPES = ["rfi", "advisory", "data", "awards", "claim"] as const;
/** Website accounts. Staff live in a separate table used only by the admin platform. */
export const ACCOUNT_TYPES = ["visitor", "provider"] as const;
/** Kind: constant. Roles of FundHub staff in the admin console; each role sees different parts of it. */
export const STAFF_ROLES = ["owner", "operations", "analyst", "sales"] as const;
/** Kind: constant. States of a request by a person to take control of ("claim") a provider profile. */
export const CLAIM_STATUSES = ["pending", "approved", "rejected"] as const;
/** Kind: constant. Whether a Data Intelligence report is free to all or only for paying members/providers. */
export const REPORT_VISIBILITY = ["public", "private"] as const;
/** Kind: constant. Moderation states of a peer review: reviews are only shown once "approved". */
export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
/** Kind: constant. What a reviewer must declare about their relationship with the reviewed provider. */
export const CLIENT_RELATIONSHIPS = ["Current client", "Former client (last 3 years)"] as const;
/** Kind: constant. Where the scraper got data from: "ai_web" (AI reading websites) or "rcs" (business register). */
export const INGEST_SOURCES = ["ai_web", "rcs"] as const;
/** Kind: constant. States of one scraper run (a batch). */
export const INGEST_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
/** Kind: constant. States of one job inside a scraper run. */
export const INGEST_JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
/** Kind: constant. Review outcome of one record the scraper found, before it reaches a provider profile. */
export const INGEST_RECORD_STATUSES = ["pending", "accepted", "rejected", "partial"] as const;
/**
 * Kind: constant. Delivery states of a sent email (see packages/email/src/send.ts). "bounced" = the address
 * rejected it; "complained" = the recipient marked it as spam.
 */
export const EMAIL_STATUSES = ["queued", "sent", "delivered", "bounced", "complained", "failed"] as const;
/** Kind: constant. Paid "Pro" subscription levels for providers, matching the provider size bands. */
export const PRO_TIERS = ["boutique", "mid_market", "institutional"] as const;
/** Everything a Stripe subscription can be: provider Pro tiers, or a Data Intelligence membership. */
// `...PRO_TIERS` (spread) copies the three Pro tiers into this new array, then "data_member" is added, giving
// ["boutique", "mid_market", "institutional", "data_member"]. Reusing PRO_TIERS avoids typing them twice.
export const SUBSCRIPTION_PLANS = [...PRO_TIERS, "data_member"] as const;

// Content & marketing
/** Kind: constant. Kinds of article: "news" (news section) or "learn" (educational guides). */
export const POST_KINDS = ["news", "learn"] as const;
/** Kind: constant. Editorial states of an article. */
export const POST_STATUSES = ["draft", "published", "archived"] as const;
/** Kind: constant. Social networks the console can prepare posts for. */
export const SOCIAL_NETWORKS = ["linkedin", "x", "facebook", "instagram"] as const;
/**
 * Kind: type alias. Any one network name: "linkedin" | "x" | "facebook" | "instagram" (see the pattern above).
 * It is declared here, earlier than the other types, because SOCIAL_LIMITS just below needs it.
 */
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
/** Kind: constant. Approval states of a social-media post. */
export const SOCIAL_POST_STATUSES = ["draft", "approved", "published"] as const;
/** Character limits used when adapting a post to each network. */
// `: Record<SocialNetwork, number>` is a type annotation: the object must have exactly one numeric entry for
// EVERY network. If a new network were added to SOCIAL_NETWORKS, TypeScript would flag this line until a limit
// is added too. That is the benefit of deriving types from the lists.
export const SOCIAL_LIMITS: Record<SocialNetwork, number> = { linkedin: 3000, x: 280, facebook: 2000, instagram: 2200 };

// Finance (management accounting; statutory books stay with the accountant / accounting system)
/** Kind: constant. Categories for FundHub's own business expenses, recorded in the console. */
export const EXPENSE_CATEGORIES = [
  "Software & SaaS",
  "Hosting & infrastructure",
  "AI & data providers",
  "Marketing & events",
  "Professional fees",
  "Office & rent",
  "Travel",
  "Salaries & contractors",
  "Insurance",
  "Bank & payment fees",
  "Taxes & duties",
  "Other",
] as const;
/** Kind: constant. Whether an expense has only been recorded or has also been paid. */
export const EXPENSE_STATUSES = ["recorded", "paid"] as const;
/** Luxembourg VAT rates (%). */
// Numbers work with `as const` too: the type becomes 17 | 14 | 8 | 3 | 0 instead of just `number`.
export const VAT_RATES = [17, 14, 8, 3, 0] as const;

// GDPR
// (GDPR = the EU data-protection law. People can ask FundHub to see, delete, correct or stop using their data.)
/** Kind: constant. The kinds of GDPR request a person can make. */
export const GDPR_REQUEST_TYPES = ["access", "deletion", "rectification", "objection"] as const;
/** Kind: constant. Handling states of a GDPR request. */
export const GDPR_REQUEST_STATUSES = ["received", "verifying", "completed", "rejected"] as const;

// TYPES DERIVED FROM THE LISTS ABOVE
// Each line below follows the pattern explained at the top: "one item of that list", as a union type.
// `export type` makes the type importable by other files, e.g. `import type { StaffRole } from "@fundhub/core/enums"`.
// Only the lists other code actually needs as types are given a name here.
/** "Boutique" | "Mid-Market" | "Institutional" */
export type ProviderType = (typeof PROVIDER_TYPES)[number];
/** "staged" | "published" | "archived" */
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
/** "rfi" | "advisory" | "data" | "awards" | "claim" */
export type RequestType = (typeof REQUEST_TYPES)[number];
/** "visitor" | "provider" */
export type AccountType = (typeof ACCOUNT_TYPES)[number];
/** "owner" | "operations" | "analyst" | "sales" */
export type StaffRole = (typeof STAFF_ROLES)[number];
/** "public" | "private" */
export type ReportVisibility = (typeof REPORT_VISIBILITY)[number];
/** "ai_web" | "rcs" */
export type IngestSource = (typeof INGEST_SOURCES)[number];
/** "boutique" | "mid_market" | "institutional" */
export type ProTier = (typeof PRO_TIERS)[number];
/** "boutique" | "mid_market" | "institutional" | "data_member" */
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];
