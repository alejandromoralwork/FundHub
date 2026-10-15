/** Shared enumerations used by the website, the admin platform, the database schema and the scraper. */

export const PROVIDER_TYPES = ["Boutique", "Mid-Market", "Institutional"] as const;
export const TECH_STACKS = ["eFront", "Investran", "Yardi", "Multifonds", "Paxus", "Allvue", "Sage"] as const;
export const REGULATORY_SCOPES = ["AIFMD", "UCITS", "RAIF", "SIF", "SICAR", "ELTIF", "Securitisation"] as const;
export const ASSET_CLASSES = [
  "Private Equity",
  "Real Estate",
  "Private Debt",
  "Infrastructure",
  "Venture Capital",
  "Liquid / UCITS",
] as const;
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
export const CERTIFICATIONS = ["ISAE 3402", "SOC 1 Type II", "SOC 2 Type II", "ISO 27001"] as const;
export const PROVIDER_STATUSES = ["staged", "published", "archived"] as const;
/** Workflow of inbound form submissions, managed in the admin platform. */
export const RFI_STATUSES = ["open", "in_progress", "responded", "closed"] as const;
/** "claim" is legacy (pre-accounts provider contact); kept so stored rows stay valid. */
export const REQUEST_TYPES = ["rfi", "advisory", "data", "awards", "claim"] as const;
/** Website accounts. Staff live in a separate table used only by the admin platform. */
export const ACCOUNT_TYPES = ["visitor", "provider"] as const;
export const STAFF_ROLES = ["owner", "operations", "analyst", "sales"] as const;
export const CLAIM_STATUSES = ["pending", "approved", "rejected"] as const;
export const REPORT_VISIBILITY = ["public", "private"] as const;
export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export const CLIENT_RELATIONSHIPS = ["Current client", "Former client (last 3 years)"] as const;
export const INGEST_SOURCES = ["ai_web", "rcs"] as const;
export const INGEST_RUN_STATUSES = ["running", "succeeded", "failed"] as const;
export const INGEST_JOB_STATUSES = ["queued", "running", "done", "failed"] as const;
export const INGEST_RECORD_STATUSES = ["pending", "accepted", "rejected", "partial"] as const;
export const EMAIL_STATUSES = ["queued", "sent", "delivered", "bounced", "complained", "failed"] as const;
export const PRO_TIERS = ["boutique", "mid_market", "institutional"] as const;

// Content & marketing
export const POST_KINDS = ["news", "learn"] as const;
export const POST_STATUSES = ["draft", "published", "archived"] as const;
export const SOCIAL_NETWORKS = ["linkedin", "x", "facebook", "instagram"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];
export const SOCIAL_POST_STATUSES = ["draft", "approved", "published"] as const;
/** Character limits used when adapting a post to each network. */
export const SOCIAL_LIMITS: Record<SocialNetwork, number> = { linkedin: 3000, x: 280, facebook: 2000, instagram: 2200 };

// Finance (management accounting; statutory books stay with the accountant / accounting system)
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
export const EXPENSE_STATUSES = ["recorded", "paid"] as const;
/** Luxembourg VAT rates (%). */
export const VAT_RATES = [17, 14, 8, 3, 0] as const;

// GDPR
export const GDPR_REQUEST_TYPES = ["access", "deletion", "rectification", "objection"] as const;
export const GDPR_REQUEST_STATUSES = ["received", "verifying", "completed", "rejected"] as const;

export type ProviderType = (typeof PROVIDER_TYPES)[number];
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];
export type RequestType = (typeof REQUEST_TYPES)[number];
export type AccountType = (typeof ACCOUNT_TYPES)[number];
export type StaffRole = (typeof STAFF_ROLES)[number];
export type ReportVisibility = (typeof REPORT_VISIBILITY)[number];
export type IngestSource = (typeof INGEST_SOURCES)[number];
export type ProTier = (typeof PRO_TIERS)[number];
