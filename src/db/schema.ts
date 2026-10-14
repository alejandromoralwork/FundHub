import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
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
export const REQUEST_TYPES = ["rfi", "advisory", "claim"] as const;

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

export type Provider = typeof providers.$inferSelect;
export type NewProvider = typeof providers.$inferInsert;
export type RfiRequest = typeof rfiRequests.$inferSelect;
export type NewRfiRequest = typeof rfiRequests.$inferInsert;
