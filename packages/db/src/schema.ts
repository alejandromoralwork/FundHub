/**
 * FILE: packages/db/src/schema.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: Describes every table in the FundHub Postgres database, in TypeScript: the table names,
 *   their columns and column types, which columns are required, default values, keys and indexes.
 *   This one file is the "source of truth": drizzle-kit compares it with the database and generates the SQL
 *   migration files (packages/db/drizzle/*.sql), and Drizzle ORM uses it to type-check every query.
 * WHERE IT RUNS: on the server (Node.js), wherever the database is used, and by drizzle-kit on a developer's
 *   machine. Nothing here talks to the database by itself; it only describes it.
 * DATABASE BASICS USED BELOW:
 *   - A table is like a spreadsheet tab: columns (fixed, typed fields) and rows (records).
 *   - Primary key: the column whose value uniquely identifies a row (usually `id`). `serial` makes Postgres
 *     number new rows automatically 1, 2, 3… using a hidden counter called a sequence.
 *   - NOT NULL (`.notNull()`): the column must always have a value. Without it, NULL ("no value") is allowed.
 *   - DEFAULT (`.default(x)`, `.defaultNow()`): the value used when an insert does not give one.
 *   - UNIQUE (`.unique()`, `uniqueIndex`): no two rows may share that value (or combination of values).
 *   - Foreign key (`.references(() => other.id, { onDelete })`): this column must contain an id that exists
 *     in another table. `onDelete` says what happens when that other row is deleted: "cascade" = delete this
 *     row too; "set null" = keep this row but empty the pointer.
 *   - Index (`index("name").on(col)`): a sorted look-up structure, like a book index, that makes searching
 *     or sorting by that column fast, at a small cost on every write.
 *   - Column types: text, integer (whole number), real (decimal number), boolean (true/false),
 *     timestamp with time zone (a date and time), jsonb (JSON data stored in binary form), bytea (raw bytes).
 * FRAMEWORK NOTES: `pgTable("sql_name", { tsName: type("sql_column_name")… }, (t) => [indexes])` defines a
 *   table. The TypeScript property names are camelCase (priceMin); the real database names are snake_case
 *   (price_min). Chained calls like `.notNull().default(0)` add rules to a column.
 * TYPESCRIPT YOU WILL SEE HERE: `export const`, arrow functions, generics `customType<{...}>` and
 *   `$type<string[]>()` (tell TypeScript the exact type stored), `export *` (re-export everything from
 *   another module), `type` imports, spread `...timestamps`, type aliases built with `typeof table.$inferSelect`.
 */

// `import { a } from "b"`: bring named items from another module. drizzle-orm is an npm library;
// `@fundhub/core/…` is our own shared package in packages/core.
// `sql` writes raw SQL fragments, used here for some default values.
import { sql } from "drizzle-orm";
// Building blocks for Postgres tables ("pg-core"): column types (boolean, integer, jsonb, real, serial, text,
// timestamp), `customType` for types Drizzle lacks, `pgTable` to define a table, and index/key helpers.
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
// Lists of allowed values for status-like columns (e.g. PROVIDER_STATUSES = ["staged", "published", …]).
// They live in packages/core so the website, console and database all share the same lists.
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
// `import type` brings in only a type; it disappears when the code is compiled, so no code is loaded.
import type { CategorySlug } from "@fundhub/core/taxonomy";

// `export *` re-exports every item of the enums module, so `import { PROVIDER_TYPES } from "@fundhub/db"` works.
export * from "@fundhub/core/enums";
/** Kind: type alias. Another name for CategorySlug ("one of the official category slugs"). */
export type Category = CategorySlug;

/**
 * Kind: constant (a custom column type).
 * Drizzle has no built-in `bytea` (raw binary data, e.g. a PDF file), so we declare one. The generic
 * `<{ data: Buffer; driverData: Buffer }>` says: in TypeScript the value is a Node.js Buffer (a block of
 * bytes), and the pg driver also hands us a Buffer. `dataType: () => "bytea"` is the SQL type name.
 */
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
/**
 * Kind: constant holding an arrow function (a small helper).
 * `ts("created_at")` = a "timestamp with time zone" column, which stores an exact moment in time.
 * @param name  type `string` — the database column name.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true });
/**
 * Kind: constant holding an arrow function (a helper for list columns).
 * A required jsonb column holding a list of texts, empty list by default.
 * `$type<string[]>()` tells TypeScript the JSON is an array of strings. sql`'[]'::jsonb` is the SQL default
 * value: the text '[]' converted (`::`) to jsonb, i.e. an empty JSON array.
 * @param name  type `string` — the database column name.
 */
const list = (name: string) => jsonb(name).$type<string[]>().notNull().default(sql`'[]'::jsonb`);

/**
 * Kind: constant (two column definitions reused by many tables via `...timestamps`).
 * createdAt: set to "now" when the row is inserted. updatedAt: also starts at now, and
 * `$onUpdate(() => new Date())` makes Drizzle put the current time in it whenever the row is updated through
 * Drizzle (this happens in our code, not inside Postgres).
 */
const timestamps = {
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at")
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

// ============================================================ website: catalogue

/**
 * Kind: constant (a table definition). Table "providers": every service provider in the directory.
 * The third argument `(t) => [ … ]` receives the table's columns as `t` and returns its indexes: here on
 * status and on category, because almost every website query filters on "status = 'published'" and many by
 * category. `slug` is `.unique()`, which also creates an index, so look-ups by URL are fast.
 */
export const providers = pgTable(
  "providers",
  {
    // Auto-numbered primary key.
    id: serial("id").primaryKey(),
    // URL-friendly unique name, e.g. "lumen-fund-services-s-a".
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    /** Primary taxonomy category slug (see @fundhub/core/taxonomy). */
    // `$type<CategorySlug>()`: stored as text, but TypeScript only accepts official slugs.
    category: text("category").$type<CategorySlug>().notNull(),
    /** Other categories the provider also serves. */
    secondaryCategories: jsonb("secondary_categories").$type<CategorySlug[]>().notNull().default(sql`'[]'::jsonb`),
    // `{ enum: PROVIDER_TYPES }`: Drizzle types the column as one of those values (the database stores text).
    providerType: text("provider_type", { enum: PROVIDER_TYPES }).notNull(),
    headcount: integer("headcount").notNull(),
    /** Number of active client mandates ("client portfolio density"). */
    mandates: integer("mandates").notNull().default(0),
    // List columns (JSON arrays of texts), built with the `list` helper above.
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
    // No .notNull(): this column may be empty (NULL) when unknown.
    setupFee: integer("setup_fee"),
    // Average review rating 0–5 (a decimal, hence `real`) and how many reviews it is based on.
    rating: real("rating").notNull().default(0),
    reviewCount: integer("review_count").notNull().default(0),
    // FundHub has checked the provider (a paid service).
    verified: boolean("verified").notNull().default(false),
    // Luxembourg trade register (RCS) number.
    rcsNumber: text("rcs_number"),
    foundedYear: integer("founded_year"),
    headquarters: text("headquarters").notNull().default("Luxembourg"),
    website: text("website"),
    description: text("description").notNull().default(""),
    // When FundHub last verified the profile.
    lastVerifiedAt: ts("last_verified_at"),
    /** Last time the provider edited its own profile (self-reported data). */
    providerUpdatedAt: ts("provider_updated_at"),
    // "staged" (imported, hidden) or "published" (visible), etc.
    status: text("status", { enum: PROVIDER_STATUSES }).notNull().default("published"),
    // Spread: adds the createdAt and updatedAt columns defined above.
    ...timestamps,
  },
  (t) => [index("providers_status_idx").on(t.status), index("providers_category_idx").on(t.category)],
);

/** Inbound form submissions: RFIs, advisory, data services, award nominations. */
/**
 * Kind: constant (table "rfi_requests"). RFI = request for information, sent by a fund manager.
 * `providerId` points at providers.id (foreign key); if the provider is deleted the request is kept and the
 * pointer emptied ("set null"). `.references(() => providers.id)` uses an arrow function so a table can point
 * at a table defined later in the file (staffUsers below).
 * Indexes: by provider, by status, and a two-column index (request type, creation date) that speeds up
 * "requests of this type, newest first".
 */
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
    // Assets under management, as a band such as "100m-250m".
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
/**
 * Kind: constant (table "users"). Email is unique: one account per address. Passwords are never stored,
 * only a one-way "hash" (a scrambled fingerprint that can check a password but not reveal it).
 * This table has no third argument, so no extra indexes beyond the primary key and the unique email.
 */
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

/**
 * Kind: constant (table "sessions"). One row per logged-in browser. The primary key is a text id (not a
 * number). Deleting a user deletes their sessions ("cascade"), which logs them out everywhere.
 * `createdAt: timestamps.createdAt` reuses just one of the two timestamp columns.
 */
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
/**
 * Kind: constant (table "password_resets"). `usedAt` stays NULL until the link is used, so it cannot be
 * used twice; `expiresAt` limits how long the link works.
 */
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
/**
 * Kind: constant (table "saved_providers"). A "link table" joining users and providers (many-to-many: a user
 * saves many providers, a provider is saved by many users). It has no id column; instead the primary key is
 * the pair (user_id, provider_id) — a "composite" key — so the same provider cannot be saved twice by one user.
 */
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
 *
 * Kind: constant (table "provider_claims"). The `proposed…` columns are used for a new listing.
 * `reviewedBy` points at the staff member who decided. The unique index on (user_id, provider_id) stops a
 * user claiming the same profile twice. (In Postgres, NULLs count as distinct, so several "new listing"
 * claims with an empty provider_id are still allowed.)
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
/**
 * Kind: constant (table "profile_edits").
 * `changes` type: `Record<string, { from: unknown; to: unknown }>` = an object whose keys are field names and
 * whose values record the old and new value, e.g. { headcount: { from: 40, to: 45 } }.
 */
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
 *
 * Kind: constant (table "reviews"). Index (provider_id, status) serves "approved reviews of this provider".
 * The unique index (provider_id, reviewer_email) allows one review per email address per provider.
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
    // Private reviewer details (never shown publicly).
    reviewerName: text("reviewer_name").notNull(),
    reviewerEmail: text("reviewer_email").notNull(),
    reviewerCompany: text("reviewer_company").notNull(),
    // Public context about the reviewer.
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
/**
 * Kind: constant (table "reports"). The PDF file itself is stored inside the database as raw bytes
 * (`bytea`, defined above); `fileSize` is its size in bytes.
 */
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
/**
 * Kind: constant (table "report_downloads"). Stores the report's slug as plain text (no foreign key), so
 * download history survives even if a report is removed. Indexed by date for "downloads over time".
 */
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
/**
 * Kind: constant (table "rate_limits"), used by src/rate-limit.ts. The text `key` (e.g. "login:<ip>") is the
 * primary key, which is what lets that code's "on conflict (key)" find the existing counter.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: ts("window_start").notNull(),
  count: integer("count").notNull().default(0),
});

// ============================================================ admin platform

/**
 * Kind: constant (table "staff_users"): FundHub employees who log in to the console. Separate from website
 * users so a website account can never gain staff powers. `active: false` disables a login without deleting it.
 */
export const staffUsers = pgTable("staff_users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: STAFF_ROLES }).notNull().default("operations"),
  /** Base32 TOTP secret; 2FA is mandatory once enrolled. */
  // TOTP = the 6-digit codes from an authenticator app (two-factor authentication, "2FA").
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").notNull().default(false),
  active: boolean("active").notNull().default(true),
  lastLoginAt: ts("last_login_at"),
  ...timestamps,
});

/**
 * Kind: constant (table "staff_sessions"): one row per logged-in console browser, as with `sessions` above.
 */
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
// Kind: constant (table "staff_password_resets"). Same design as `password_resets` above.
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
/**
 * Kind: constant (table "audit_log"). Who (staffUserId) did what (action, e.g. "update") to which thing
 * (entity, e.g. "provider", plus entityId), with the details in `changes`. entityId is text so it can hold
 * any kind of id. Indexed for "history of this thing" and "latest activity".
 */
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

/**
 * Kind: constant (table "email_messages"): every email sent (or queued) by FundHub, with its delivery
 * status. `providerMessageId` is the id given by the email-sending service (Resend), indexed so delivery
 * updates from that service can find the right row quickly. `relatedEntity`/`relatedId` link the email to
 * what it was about (e.g. an RFI).
 */
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
/**
 * Kind: constant (table "billing_customers"). Stripe is the payment service; we keep a copy of its data
 * for reports. Each Stripe id is unique, so the same Stripe record is never copied twice.
 */
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

/**
 * Kind: constant (table "subscriptions"): a customer's recurring plan. Deleting the customer deletes its
 * subscriptions ("cascade"). Money is stored in cents as whole numbers to avoid rounding errors.
 */
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

/**
 * Kind: constant (table "invoices"): copies of Stripe invoices (amounts in cents), with links to Stripe's
 * hosted invoice page and PDF.
 */
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

/**
 * Kind: constant (table "ingest_runs"): one row per scraper run: which source, its status, how it was
 * started (`trigger`), counters (`stats`, e.g. { pages: 12, records: 30 }), any error, start and end time.
 */
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
/**
 * Kind: constant (table "ingest_jobs"): a simple to-do queue. The console adds rows with status "queued";
 * the scraper picks them up (the status index makes "find queued jobs" fast) and links the run it started.
 */
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
/**
 * Kind: type alias. `value: unknown` = any value; `confidence` = how sure the scraper is (a number);
 * `sourceUrl?: string | null` = optional (`?`), and if present either a web address or null.
 */
export type ExtractedField = { value: unknown; confidence: number; sourceUrl?: string | null };

/** Scraped data waiting for staff review. Nothing reaches `providers` without review. */
/**
 * Kind: constant (table "ingest_records"). `raw` = what the scraper saw; `extracted` = field name ->
 * ExtractedField; `acceptedFields` = the names of the fields a staff member copied into the provider profile.
 */
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
/**
 * Kind: constant (table "posts"). Markdown is a simple text format (# for headings, * for lists).
 * `aiGenerated`/`aiBrief` record whether an AI drafted the article and what it was asked.
 * The index (status, published_at) serves "published posts, newest first".
 */
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
/**
 * Kind: constant (table "social_posts"). The unique index (post_id, network) allows one version per network
 * per article. Deleting the article deletes its social versions ("cascade").
 */
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
 *
 * Kind: constant (table "expenses"). `vatRate` is a percentage (17 = Luxembourg's standard VAT rate).
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
/**
 * Kind: constant (table "budgets"). The unique index (month, category) allows only one budget figure per
 * category per month.
 */
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

/**
 * Kind: constant (table "gdpr_requests"). GDPR is the EU data-protection law; people may ask to see,
 * correct or delete their personal data. Each request is logged with a legal deadline and its outcome.
 */
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

// Kind: type aliases derived from the tables, so the rest of the code never retypes column lists.
// `typeof providers.$inferSelect` = the shape of a row READ from providers (every column present).
// `typeof providers.$inferInsert` = the shape of a row to INSERT (columns with defaults, or that allow NULL,
// become optional).
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
