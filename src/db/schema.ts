import { sql } from "drizzle-orm";
import { blob, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
// Type-only: keeps drizzle-kit from loading the taxonomy (and its icons).
import type { CategorySlug } from "@/lib/taxonomy";

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
export const RFI_STATUSES = ["open", "responded", "closed"] as const;
/** "claim" is legacy (pre-accounts provider contact); kept so stored rows stay valid. */
export const REQUEST_TYPES = ["rfi", "advisory", "data", "awards", "claim"] as const;
export const USER_ROLES = ["provider", "admin"] as const;
export const CLAIM_STATUSES = ["pending", "approved", "rejected"] as const;
export const REPORT_VISIBILITY = ["public", "private"] as const;
export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export const CLIENT_RELATIONSHIPS = ["Current client", "Former client (last 3 years)"] as const;

export type Category = CategorySlug;
export type RequestType = (typeof REQUEST_TYPES)[number];
export type ProviderType = (typeof PROVIDER_TYPES)[number];
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number];

const timestamps = {
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)
    .$onUpdate(() => new Date()),
};

export const providers = sqliteTable(
  "providers",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** Primary taxonomy category slug (see src/lib/taxonomy.ts). */
    category: text("category").$type<CategorySlug>().notNull(),
    /** Other categories the provider also serves. */
    secondaryCategories: text("secondary_categories", { mode: "json" })
      .$type<CategorySlug[]>()
      .notNull()
      .default(sql`'[]'`),
    providerType: text("provider_type", { enum: PROVIDER_TYPES }).notNull(),
    headcount: integer("headcount").notNull(),
    /** Number of active client mandates ("client portfolio density"). */
    mandates: integer("mandates").notNull().default(0),
    techStack: text("tech_stack", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    topClients: text("top_clients", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    regulatoryScope: text("regulatory_scope", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    services: text("services", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    tags: text("tags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    assetClasses: text("asset_classes", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    /** CSSF / professional authorisations. */
    licences: text("licences", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    certifications: text("certifications", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    /** Countries with an operational office (geographical footprint). */
    footprint: text("footprint", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    /** Empirical quarterly fee range, EUR. */
    priceMin: integer("price_min").notNull(),
    priceMax: integer("price_max").notNull(),
    /** Typical one-off onboarding fee, EUR. */
    setupFee: integer("setup_fee"),
    rating: real("rating").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    verified: integer("verified", { mode: "boolean" }).notNull().default(false),
    rcsNumber: text("rcs_number"),
    foundedYear: integer("founded_year"),
    headquarters: text("headquarters").notNull().default("Luxembourg"),
    website: text("website"),
    description: text("description").notNull().default(""),
    lastVerifiedAt: integer("last_verified_at", { mode: "timestamp" }),
    /** Last time the provider edited its own profile (self-reported data). */
    providerUpdatedAt: integer("provider_updated_at", { mode: "timestamp" }),
    status: text("status", { enum: PROVIDER_STATUSES }).notNull().default("published"),
    ...timestamps,
  },
  (t) => [index("providers_status_idx").on(t.status), index("providers_category_idx").on(t.category)],
);

export const rfiRequests = sqliteTable(
  "rfi_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    requestType: text("request_type", { enum: REQUEST_TYPES }).notNull().default("rfi"),
    providerId: integer("provider_id").references(() => providers.id, { onDelete: "set null" }),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    company: text("company").notNull(),
    fundStructure: text("fund_structure").notNull(),
    aumBand: text("aum_band").notNull(),
    servicesNeeded: text("services_needed", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    message: text("message").notNull().default(""),
    status: text("status", { enum: RFI_STATUSES }).notNull().default("open"),
    ...timestamps,
  },
  (t) => [index("rfi_provider_idx").on(t.providerId), index("rfi_status_idx").on(t.status)],
);

/** Service-provider accounts (and FundHub admins). Visitors never need an account. */
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: USER_ROLES }).notNull().default("provider"),
  ...timestamps,
});

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/**
 * A user's request to manage a provider profile. An approved claim is what grants
 * edit rights. `providerId` is null when the user proposes a new listing.
 */
export const providerClaims = sqliteTable(
  "provider_claims",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" }),
    proposedName: text("proposed_name"),
    proposedCategory: text("proposed_category"),
    proposedWebsite: text("proposed_website"),
    jobTitle: text("job_title").notNull().default(""),
    message: text("message").notNull().default(""),
    status: text("status", { enum: CLAIM_STATUSES }).notNull().default("pending"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (t) => [
    index("claims_status_idx").on(t.status),
    uniqueIndex("claims_user_provider_unique").on(t.userId, t.providerId),
  ],
);

/** Audit log of provider self-edits (field-level before/after). */
export const profileEdits = sqliteTable(
  "profile_edits",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    changes: text("changes", { mode: "json" }).$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("edits_provider_idx").on(t.providerId)],
);

/** Uploaded PDF reports. Built-in generated reports live in src/content/reports.ts. */
export const reports = sqliteTable("reports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  period: text("period").notNull(),
  summary: text("summary").notNull().default(""),
  visibility: text("visibility", { enum: REPORT_VISIBILITY }).notNull().default("private"),
  pdf: blob("pdf", { mode: "buffer" }).notNull(),
  fileSize: integer("file_size").notNull(),
  ...timestamps,
});

/**
 * Client reviews. Published only after FundHub verifies the reviewer is a genuine client
 * (work email + evidence). Reviewer identity is never shown publicly (double-blind).
 */
export const reviews = sqliteTable(
  "reviews",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    reviewerName: text("reviewer_name").notNull(),
    reviewerEmail: text("reviewer_email").notNull(),
    reviewerCompany: text("reviewer_company").notNull(),
    reviewerRole: text("reviewer_role").notNull(),
    relationship: text("relationship", { enum: CLIENT_RELATIONSHIPS }).notNull(),
    clientSince: integer("client_since"),
    fundStructure: text("fund_structure").notNull().default(""),
    /** Scores 1–5. `overall` feeds the Peer Opinion Score. */
    overall: integer("overall").notNull(),
    serviceQuality: integer("service_quality").notNull(),
    responsiveness: integer("responsiveness").notNull(),
    pricingTransparency: integer("pricing_transparency").notNull(),
    technology: integer("technology").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    /** Free-text evidence offered by the reviewer (e.g. contract reference, invoice month). Never published. */
    evidence: text("evidence").notNull().default(""),
    /** Automatic checks raised at submission, for the admin reviewer. */
    flags: text("flags", { mode: "json" }).$type<string[]>().notNull().default(sql`'[]'`),
    status: text("status", { enum: REVIEW_STATUSES }).notNull().default("pending"),
    reviewedAt: integer("reviewed_at", { mode: "timestamp" }),
    ...timestamps,
  },
  (t) => [
    index("reviews_provider_status_idx").on(t.providerId, t.status),
    uniqueIndex("reviews_provider_email_unique").on(t.providerId, t.reviewerEmail),
  ],
);

export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;
export type RfiRequest = typeof rfiRequests.$inferSelect;
export type NewRfiRequest = typeof rfiRequests.$inferInsert;
export type User = typeof users.$inferSelect;
export type ProviderClaim = typeof providerClaims.$inferSelect;
export type ReportVisibility = (typeof REPORT_VISIBILITY)[number];
export type Review = typeof reviews.$inferSelect;
