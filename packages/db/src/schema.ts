import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import {
  ACCOUNT_TYPES,
  CLAIM_STATUSES,
  CLIENT_RELATIONSHIPS,
  EMAIL_STATUSES,
  INGEST_JOB_STATUSES,
  INGEST_RECORD_STATUSES,
  INGEST_RUN_STATUSES,
  INGEST_SOURCES,
  PRO_TIERS,
  SUBSCRIPTION_PLANS,
  EXPENSE_STATUSES,
  GDPR_REQUEST_STATUSES,
  GDPR_REQUEST_TYPES,
  POST_KINDS,
  POST_STATUSES,
  SOCIAL_NETWORKS,
  SOCIAL_POST_STATUSES,
  PROVIDER_STATUSES,
  PROVIDER_TYPES,
  REPORT_VISIBILITY,
  REQUEST_TYPES,
  REVIEW_STATUSES,
  RFI_STATUSES,
  STAFF_ROLES,
} from "@fundhub/core/enums";
// Type-only: keeps drizzle-kit from loading the taxonomy (and its icons).
import type { CategorySlug } from "@fundhub/core/taxonomy";

export * from "@fundhub/core/enums";
export type Category = CategorySlug;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const ts = (name: string) => timestamp(name, { withTimezone: true });
const list = (name: string) => jsonb(name).$type<string[]>().notNull().default(sql`'[]'::jsonb`);

const timestamps = {
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ============================================================ website: catalogue

export const providers = pgTable(
  "providers",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** Primary taxonomy category slug (see @fundhub/core/taxonomy). */
    category: text("category").$type<CategorySlug>().notNull(),
    /** Other categories the provider also serves. */
    secondaryCategories: jsonb("secondary_categories").$type<CategorySlug[]>().notNull().default(sql`'[]'::jsonb`),
    providerType: text("provider_type", { enum: PROVIDER_TYPES }).notNull(),
    headcount: integer("headcount").notNull(),
    /** Number of active client mandates ("client portfolio density"). */
    mandates: integer("mandates").notNull().default(0),
    techStack: list("tech_stack"),
    topClients: list("top_clients"),
    regulatoryScope: list("regulatory_scope"),
    services: list("services"),
    tags: list("tags"),
    assetClasses: list("asset_classes"),
    /** CSSF / professional authorisations. */
    licences: list("licences"),
    certifications: list("certifications"),
    /** Countries with an operational office (geographical footprint). */
    footprint: list("footprint"),
    /** Empirical quarterly fee range, EUR. */
    priceMin: integer("price_min").notNull(),
    priceMax: integer("price_max").notNull(),
    /** Typical one-off onboarding fee, EUR. */
    setupFee: integer("setup_fee"),
    rating: real("rating").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    verified: boolean("verified").notNull().default(false),
    rcsNumber: text("rcs_number"),
    foundedYear: integer("founded_year"),
    headquarters: text("headquarters").notNull().default("Luxembourg"),
    website: text("website"),
    description: text("description").notNull().default(""),
    lastVerifiedAt: ts("last_verified_at"),
    /** Last time the provider edited its own profile (self-reported data). */
    providerUpdatedAt: ts("provider_updated_at"),
    status: text("status", { enum: PROVIDER_STATUSES }).notNull().default("published"),
    ...timestamps,
  },
  (t) => [index("providers_status_idx").on(t.status), index("providers_category_idx").on(t.category)],
);

/** Inbound form submissions: RFIs, advisory, data services, award nominations. */
export const rfiRequests = pgTable(
  "rfi_requests",
  {
    id: serial("id").primaryKey(),
    requestType: text("request_type", { enum: REQUEST_TYPES }).notNull().default("rfi"),
    providerId: integer("provider_id").references(() => providers.id, { onDelete: "set null" }),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    company: text("company").notNull(),
    fundStructure: text("fund_structure").notNull(),
    aumBand: text("aum_band").notNull(),
    servicesNeeded: list("services_needed"),
    message: text("message").notNull().default(""),
    status: text("status", { enum: RFI_STATUSES }).notNull().default("open"),
    /** Staff member handling the request (admin platform). */
    assignedTo: integer("assigned_to").references(() => staffUsers.id, { onDelete: "set null" }),
    internalNotes: text("internal_notes").notNull().default(""),
    /** Opportunity id in the CRM (Twenty) once synced. */
    crmRef: text("crm_ref"),
    ...timestamps,
  },
  (t) => [
    index("rfi_provider_idx").on(t.providerId),
    index("rfi_status_idx").on(t.status),
    index("rfi_type_created_idx").on(t.requestType, t.createdAt),
  ],
);

// ============================================================ website: accounts

/** Website accounts: visitors and service providers. Staff use `staff_users`. */
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  accountType: text("account_type", { enum: ACCOUNT_TYPES }).notNull().default("visitor"),
  company: text("company").notNull().default(""),
  newsletterOptIn: boolean("newsletter_opt_in").notNull().default(false),
  ...timestamps,
});

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 of the session token; the raw token only lives in the cookie. */
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: ts("expires_at").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

/** Single-use password reset tokens (hashed). */
export const passwordResets = pgTable("password_resets", {
  id: text("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: timestamps.createdAt,
});

/** A visitor's shortlist. */
export const savedProviders = pgTable(
  "saved_providers",
  {
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [primaryKey({ columns: [t.userId, t.providerId] })],
);

/**
 * A provider account's request to manage a company profile. An approved claim grants
 * edit rights. `providerId` is null when the user proposes a new listing.
 */
export const providerClaims = pgTable(
  "provider_claims",
  {
    id: serial("id").primaryKey(),
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
    reviewedAt: ts("reviewed_at"),
    reviewedBy: integer("reviewed_by").references(() => staffUsers.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("claims_status_idx").on(t.status),
    uniqueIndex("claims_user_provider_unique").on(t.userId, t.providerId),
  ],
);

/** Audit log of provider self-edits (field-level before/after). */
export const profileEdits = pgTable(
  "profile_edits",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    changes: jsonb("changes").$type<Record<string, { from: unknown; to: unknown }>>().notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("edits_provider_idx").on(t.providerId)],
);

/**
 * Client reviews. Published only after FundHub verifies the reviewer is a genuine client
 * (work email + evidence). Reviewer identity is never shown publicly (double-blind).
 */
export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    providerId: integer("provider_id")
      .notNull()
      .references(() => providers.id, { onDelete: "cascade" }),
    /** Set when the reviewer was logged in. */
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
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
    /** Free-text evidence offered by the reviewer. Never published. */
    evidence: text("evidence").notNull().default(""),
    /** Automatic checks raised at submission, for the staff reviewer. */
    flags: list("flags"),
    status: text("status", { enum: REVIEW_STATUSES }).notNull().default("pending"),
    reviewedAt: ts("reviewed_at"),
    reviewedBy: integer("reviewed_by").references(() => staffUsers.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [
    index("reviews_provider_status_idx").on(t.providerId, t.status),
    uniqueIndex("reviews_provider_email_unique").on(t.providerId, t.reviewerEmail),
  ],
);

/** Uploaded PDF reports. Built-in generated reports live in the web app. */
export const reports = pgTable("reports", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  period: text("period").notNull(),
  summary: text("summary").notNull().default(""),
  visibility: text("visibility", { enum: REPORT_VISIBILITY }).notNull().default("private"),
  pdf: bytea("pdf").notNull(),
  fileSize: integer("file_size").notNull(),
  ...timestamps,
});

/** One row per report download, for analytics. */
export const reportDownloads = pgTable(
  "report_downloads",
  {
    id: serial("id").primaryKey(),
    reportSlug: text("report_slug").notNull(),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("report_downloads_created_idx").on(t.createdAt)],
);

/** Fixed-window counters for rate limiting (login, forms). */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull().default(0),
});

// ============================================================ admin platform

export const staffUsers = pgTable("staff_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: STAFF_ROLES }).notNull().default("operations"),
  /** Base32 TOTP secret; 2FA is mandatory once enrolled. */
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  ...timestamps,
});

export const staffSessions = pgTable(
  "staff_sessions",
  {
    id: text("id").primaryKey(),
    staffUserId: integer("staff_user_id")
      .notNull()
      .references(() => staffUsers.id, { onDelete: "cascade" }),
    /** False until the TOTP step is completed. */
    mfaPassed: boolean("mfa_passed").notNull().default(false),
    expiresAt: ts("expires_at").notNull(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("staff_sessions_user_idx").on(t.staffUserId)],
);

/** Single-use password reset tokens for staff (hashed). Two-factor is still required after a reset. */
export const staffPasswordResets = pgTable("staff_password_resets", {
  id: text("id").primaryKey(),
  staffUserId: integer("staff_user_id")
    .notNull()
    .references(() => staffUsers.id, { onDelete: "cascade" }),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
  createdAt: timestamps.createdAt,
});

/** Every write made from the admin platform. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    staffUserId: integer("staff_user_id").references(() => staffUsers.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    changes: jsonb("changes").$type<Record<string, unknown>>(),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId), index("audit_created_idx").on(t.createdAt)],
);

export const emailMessages = pgTable(
  "email_messages",
  {
    id: serial("id").primaryKey(),
    toEmail: text("to_email").notNull(),
    toName: text("to_name"),
    subject: text("subject").notNull(),
    template: text("template").notNull(),
    /** Template props, for re-rendering / auditing. */
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    status: text("status", { enum: EMAIL_STATUSES }).notNull().default("queued"),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    relatedEntity: text("related_entity"),
    relatedId: text("related_id"),
    sentBy: integer("sent_by").references(() => staffUsers.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("email_created_idx").on(t.createdAt), index("email_provider_msg_idx").on(t.providerMessageId)],
);

/** Stripe mirror: customers, subscriptions and invoices (source of truth stays in Stripe). */
export const billingCustomers = pgTable("billing_customers", {
  id: serial("id").primaryKey(),
  stripeCustomerId: text("stripe_customer_id").notNull().unique(),
  providerId: integer("provider_id").references(() => providers.id, { onDelete: "set null" }),
  userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  email: text("email").notNull(),
  vatNumber: text("vat_number"),
  ...timestamps,
});

export const subscriptions = pgTable("subscriptions", {
  id: serial("id").primaryKey(),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => billingCustomers.id, { onDelete: "cascade" }),
  /** Pro tier for providers, or "data_member" for a Data Intelligence membership. */
  tier: text("tier", { enum: SUBSCRIPTION_PLANS }),
  status: text("status").notNull(),
  /** Amount per billing period, in cents. */
  amount: integer("amount").notNull().default(0),
  currency: text("currency").notNull().default("eur"),
  interval: text("interval").notNull().default("quarter"),
  currentPeriodEnd: ts("current_period_end"),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  ...timestamps,
});

export const invoices = pgTable(
  "invoices",
  {
    id: serial("id").primaryKey(),
    stripeInvoiceId: text("stripe_invoice_id").notNull().unique(),
    customerId: integer("customer_id")
      .notNull()
      .references(() => billingCustomers.id, { onDelete: "cascade" }),
    number: text("number"),
    description: text("description"),
    status: text("status").notNull(),
    amountDue: integer("amount_due").notNull().default(0),
    amountPaid: integer("amount_paid").notNull().default(0),
    /** VAT charged on the invoice (cents), for the VAT summary. */
    taxAmount: integer("tax_amount").notNull().default(0),
    currency: text("currency").notNull().default("eur"),
    hostedInvoiceUrl: text("hosted_invoice_url"),
    invoicePdf: text("invoice_pdf"),
    dueDate: ts("due_date"),
    ...timestamps,
  },
  (t) => [index("invoices_created_idx").on(t.createdAt)],
);

// ============================================================ data module (ingest)

export const ingestRuns = pgTable("ingest_runs", {
  id: serial("id").primaryKey(),
  source: text("source", { enum: INGEST_SOURCES }).notNull(),
  status: text("status", { enum: INGEST_RUN_STATUSES }).notNull().default("running"),
  trigger: text("trigger").notNull().default("schedule"),
  stats: jsonb("stats").$type<Record<string, number>>(),
  error: text("error"),
  startedAt: ts("started_at").notNull().defaultNow(),
  finishedAt: ts("finished_at"),
});

/** Work requested from the admin platform ("Run scrape"), drained by the scraper worker. */
export const ingestJobs = pgTable(
  "ingest_jobs",
  {
    id: serial("id").primaryKey(),
    source: text("source", { enum: INGEST_SOURCES }).notNull(),
    providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" }),
    requestedBy: integer("requested_by").references(() => staffUsers.id, { onDelete: "set null" }),
    status: text("status", { enum: INGEST_JOB_STATUSES }).notNull().default("queued"),
    runId: integer("run_id").references(() => ingestRuns.id, { onDelete: "set null" }),
    error: text("error"),
    ...timestamps,
  },
  (t) => [index("ingest_jobs_status_idx").on(t.status)],
);

/** One extracted field: value plus provenance. */
export type ExtractedField = { value: unknown; confidence: number; sourceUrl?: string | null };

/** Scraped data waiting for staff review. Nothing reaches `providers` without review. */
export const ingestRecords = pgTable(
  "ingest_records",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id").references(() => ingestRuns.id, { onDelete: "cascade" }),
    providerId: integer("provider_id").references(() => providers.id, { onDelete: "cascade" }),
    source: text("source", { enum: INGEST_SOURCES }).notNull(),
    sourceUrl: text("source_url"),
    raw: jsonb("raw").$type<Record<string, unknown>>(),
    extracted: jsonb("extracted").$type<Record<string, ExtractedField>>().notNull(),
    status: text("status", { enum: INGEST_RECORD_STATUSES }).notNull().default("pending"),
    /** Fields accepted into the provider profile. */
    acceptedFields: list("accepted_fields"),
    reviewedBy: integer("reviewed_by").references(() => staffUsers.id, { onDelete: "set null" }),
    reviewedAt: ts("reviewed_at"),
    createdAt: timestamps.createdAt,
  },
  (t) => [index("ingest_records_status_idx").on(t.status), index("ingest_records_provider_idx").on(t.providerId)],
);

// ============================================================ content

/** News & Learn articles shown on the website. Body is Markdown. */
export const posts = pgTable(
  "posts",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull().unique(),
    kind: text("kind", { enum: POST_KINDS }).notNull().default("news"),
    title: text("title").notNull(),
    summary: text("summary").notNull().default(""),
    body: text("body").notNull().default(""),
    topic: text("topic").notNull().default("FundHub"),
    /** Taxonomy category slug, for cross-links. */
    category: text("category"),
    readMinutes: integer("read_minutes").notNull().default(3),
    status: text("status", { enum: POST_STATUSES }).notNull().default("draft"),
    publishedAt: ts("published_at"),
    aiGenerated: boolean("ai_generated").notNull().default(false),
    /** The brief given to the AI, kept for transparency. */
    aiBrief: text("ai_brief"),
    authorId: integer("author_id").references(() => staffUsers.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("posts_status_published_idx").on(t.status, t.publishedAt)],
);

/** A post adapted to one social network (copy-ready; Postiz can publish them later). */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: serial("id").primaryKey(),
    postId: integer("post_id")
      .notNull()
      .references(() => posts.id, { onDelete: "cascade" }),
    network: text("network", { enum: SOCIAL_NETWORKS }).notNull(),
    text: text("text").notNull(),
    hashtags: list("hashtags"),
    status: text("status", { enum: SOCIAL_POST_STATUSES }).notNull().default("draft"),
    publishedAt: ts("published_at"),
    /** Id in the publishing tool (Postiz) once connected. */
    externalId: text("external_id"),
    ...timestamps,
  },
  (t) => [uniqueIndex("social_post_network_unique").on(t.postId, t.network)],
);

// ============================================================ finance

/**
 * Business expenses. Revenue comes from the Stripe mirror (`invoices`). Amounts in cents.
 * `syncedRef` holds the id in the accounting system once one is connected.
 */
export const expenses = pgTable(
  "expenses",
  {
    id: serial("id").primaryKey(),
    date: ts("date").notNull(),
    vendor: text("vendor").notNull(),
    category: text("category").notNull(),
    description: text("description").notNull().default(""),
    amountNet: integer("amount_net").notNull(),
    vatRate: real("vat_rate").notNull().default(17),
    vatAmount: integer("vat_amount").notNull().default(0),
    status: text("status", { enum: EXPENSE_STATUSES }).notNull().default("recorded"),
    /** Monthly recurring cost (e.g. SaaS). */
    recurring: boolean("recurring").notNull().default(false),
    /** Link or path to the receipt in the Drive (Nextcloud). */
    receiptUrl: text("receipt_url"),
    syncedRef: text("synced_ref"),
    createdBy: integer("created_by").references(() => staffUsers.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (t) => [index("expenses_date_idx").on(t.date)],
);

/** Monthly budget per expense category (cents), for budget vs actual. */
export const budgets = pgTable(
  "budgets",
  {
    id: serial("id").primaryKey(),
    month: text("month").notNull(), // YYYY-MM
    category: text("category").notNull(),
    amount: integer("amount").notNull(),
  },
  (t) => [uniqueIndex("budgets_month_category_unique").on(t.month, t.category)],
);

// ============================================================ GDPR

export const gdprRequests = pgTable("gdpr_requests", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  type: text("type", { enum: GDPR_REQUEST_TYPES }).notNull(),
  details: text("details").notNull().default(""),
  status: text("status", { enum: GDPR_REQUEST_STATUSES }).notNull().default("received"),
  /** Legal deadline: one month from receipt (GDPR Art. 12(3)). */
  dueAt: ts("due_at").notNull(),
  resolution: text("resolution").notNull().default(""),
  handledBy: integer("handled_by").references(() => staffUsers.id, { onDelete: "set null" }),
  completedAt: ts("completed_at"),
  ...timestamps,
});

// ============================================================ types

export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;
export type RfiRequest = typeof rfiRequests.$inferSelect;
export type NewRfiRequest = typeof rfiRequests.$inferInsert;
export type User = typeof users.$inferSelect;
export type ProviderClaim = typeof providerClaims.$inferSelect;
export type Review = typeof reviews.$inferSelect;
export type StaffUser = typeof staffUsers.$inferSelect;
export type IngestRecord = typeof ingestRecords.$inferSelect;
export type Post = typeof posts.$inferSelect;
export type SocialPost = typeof socialPosts.$inferSelect;
export type Expense = typeof expenses.$inferSelect;
