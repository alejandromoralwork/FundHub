import "server-only";
/**
 * FILE: packages/db/src/account-queries.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: Ready-made database reads for user accounts: a user's claims on provider profiles, claims
 *   waiting for staff review, recent profile edits, reviews (pending, published, a user's own), and a
 *   user's saved (bookmarked) providers.
 * WHERE IT RUNS: on the server only. `import "server-only"` (first line) makes the Next.js build fail if
 *   any browser-side code tries to import this file, so database code can never leak to the browser.
 * FRAMEWORK NOTES: Drizzle ORM query builder. A "join" combines rows of two tables that belong together:
 *   - `.innerJoin(B, eq(B.id, A.bId))` keeps only A rows that have a matching B row;
 *   - `.leftJoin(B, …)` keeps every A row, filling B's columns with null when there is no match.
 *   `eq(B.id, A.bId)` is the matching rule: "B.id = A.b_id", i.e. follow A's foreign key to B.
 *   `.orderBy(desc(col))` = newest/largest first; `.orderBy(col)` = oldest/smallest first; `.limit(n)` = at most n.
 * TYPESCRIPT YOU WILL SEE HERE: async functions whose return type TypeScript works out by itself (inferred),
 *   default parameter values `limit = 10`, spread `{ ...obj }`, array destructuring `[row]`, `!!x`.
 */

// `import { a } from "b"`: bring named items from another module.
// Drizzle condition/sort helpers: and(a, b) = "a AND b", desc(col) = sort descending, eq(a, b) = "a = b".
import { and, desc, eq } from "drizzle-orm";
// The shared database object.
import { db } from "./client";
// The table definitions used below.
import { profileEdits, providerClaims, providers, reviews, savedProviders, users } from "./schema";

/**
 * Kind: constant (a column selection reused by two queries).
 * Each key is the name the result field will have; each value is the column to read. Claim columns come
 * from provider_claims, the provider ones from the joined providers table.
 */
const claimColumns = {
  id: providerClaims.id,
  status: providerClaims.status,
  jobTitle: providerClaims.jobTitle,
  message: providerClaims.message,
  proposedName: providerClaims.proposedName,
  proposedCategory: providerClaims.proposedCategory,
  proposedWebsite: providerClaims.proposedWebsite,
  createdAt: providerClaims.createdAt,
  providerId: providers.id,
  providerSlug: providers.slug,
  providerName: providers.name,
};

/**
 * Kind: async function.
 * All claims made by one user, newest first. A left join, because a claim may propose a brand-new provider
 * that does not exist yet (no providerId): those claims still appear, with null provider fields.
 * @param userId  type `number` — the logged-in website user's id.
 * @returns a Promise of an array of objects shaped like claimColumns.
 */
export async function getUserClaims(userId: number) {
  return db
    .select(claimColumns)
    .from(providerClaims)
    .leftJoin(providers, eq(providers.id, providerClaims.providerId))
    .where(eq(providerClaims.userId, userId))
    .orderBy(desc(providerClaims.createdAt));
}

/**
 * Kind: async function.
 * Claims waiting for staff to approve or reject, oldest first (first come, first served), with the
 * claimant's name and email. `{ ...claimColumns, userName: …, userEmail: … }` = the same columns plus two more.
 * Inner join on users: every claim has a user. Left join on providers: as in getUserClaims.
 * @returns a Promise of an array of claim objects with userName and userEmail.
 */
export async function getClaimsForReview() {
  return db
    .select({ ...claimColumns, userName: users.name, userEmail: users.email })
    .from(providerClaims)
    .innerJoin(users, eq(users.id, providerClaims.userId))
    .leftJoin(providers, eq(providers.id, providerClaims.providerId))
    .where(eq(providerClaims.status, "pending"))
    .orderBy(providerClaims.createdAt);
}

/**
 * Kind: async function.
 * The latest changes made to one provider's profile, with the editor's name (left join: the user may have
 * been deleted, and the edit should still show).
 * @param providerId  type `number` — the provider whose history to show.
 * @param limit       type `number`, default 10 — `limit = 10` means "use 10 if the caller gives nothing".
 * @returns a Promise of up to `limit` objects { id, changes, createdAt, userName }.
 */
export async function getRecentProfileEdits(providerId: number, limit = 10) {
  return db
    .select({ id: profileEdits.id, changes: profileEdits.changes, createdAt: profileEdits.createdAt, userName: users.name })
    .from(profileEdits)
    .leftJoin(users, eq(users.id, profileEdits.userId))
    .where(eq(profileEdits.providerId, providerId))
    .orderBy(desc(profileEdits.createdAt))
    .limit(limit);
}

/**
 * Kind: async function.
 * Reviews waiting for moderation, oldest first, with the reviewed provider's name and slug.
 * `review: reviews` puts the whole review row (all columns) under one `review` field.
 * @returns a Promise of an array of { review, providerName, providerSlug }.
 */
export async function getPendingReviews() {
  return db
    .select({ review: reviews, providerName: providers.name, providerSlug: providers.slug })
    .from(reviews)
    .innerJoin(providers, eq(providers.id, reviews.providerId))
    .where(eq(reviews.status, "pending"))
    .orderBy(reviews.createdAt);
}

/** Public fields only: reviewer identity stays private (double-blind). */
/**
 * Kind: async function.
 * Approved reviews of one provider, newest first, for the public profile page. Only the listed columns are
 * read, so the reviewer's user id, name, email, company and evidence never leave the database.
 * @param providerId  type `number` — the provider being shown.
 * @returns a Promise of an array of public review objects.
 */
export async function getPublishedReviews(providerId: number) {
  return db
    .select({
      id: reviews.id,
      reviewerRole: reviews.reviewerRole,
      relationship: reviews.relationship,
      clientSince: reviews.clientSince,
      fundStructure: reviews.fundStructure,
      overall: reviews.overall,
      serviceQuality: reviews.serviceQuality,
      responsiveness: reviews.responsiveness,
      pricingTransparency: reviews.pricingTransparency,
      technology: reviews.technology,
      title: reviews.title,
      body: reviews.body,
      reviewedAt: reviews.reviewedAt,
    })
    .from(reviews)
    .where(and(eq(reviews.providerId, providerId), eq(reviews.status, "approved")))
    .orderBy(desc(reviews.reviewedAt));
}

/**
 * Kind: async function.
 * The providers a user has bookmarked, most recently saved first. saved_providers is a "link table": each
 * row just pairs a user id with a provider id; the join fetches the provider details.
 * @param userId  type `number` — the logged-in user.
 * @returns a Promise of an array of short provider summaries.
 */
export async function getSavedProviders(userId: number) {
  return db
    .select({
      id: providers.id,
      slug: providers.slug,
      name: providers.name,
      category: providers.category,
      priceMin: providers.priceMin,
      priceMax: providers.priceMax,
      rating: providers.rating,
      verified: providers.verified,
    })
    .from(savedProviders)
    .innerJoin(providers, eq(providers.id, savedProviders.providerId))
    .where(eq(savedProviders.userId, userId))
    .orderBy(desc(savedProviders.createdAt));
}

/**
 * Kind: async function.
 * Has this user bookmarked this provider? (Used to show a filled or empty "save" button.)
 * @param userId      type `number`.
 * @param providerId  type `number`.
 * @returns `Promise<boolean>`: true if a saved_providers row exists for the pair.
 */
export async function isProviderSaved(userId: number, providerId: number): Promise<boolean> {
  // `[row]` takes the first result (or undefined if there is none).
  const [row] = await db
    .select({ id: savedProviders.providerId })
    .from(savedProviders)
    .where(and(eq(savedProviders.userId, userId), eq(savedProviders.providerId, providerId)));
  // `!!row` turns "a row or undefined" into true or false.
  return !!row;
}

/** The logged-in user's own reviews, any status. */
/**
 * Kind: async function.
 * @param userId  type `number` — the logged-in user.
 * @returns a Promise of an array of { id, title, status, providerName, providerSlug }, newest first.
 */
export async function getUserReviews(userId: number) {
  return db
    .select({ id: reviews.id, title: reviews.title, status: reviews.status, providerName: providers.name, providerSlug: providers.slug })
    .from(reviews)
    .innerJoin(providers, eq(providers.id, reviews.providerId))
    .where(eq(reviews.userId, userId))
    .orderBy(desc(reviews.createdAt));
}
