import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "./client";
import { profileEdits, providerClaims, providers, reviews, savedProviders, users } from "./schema";

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

export async function getUserClaims(userId: number) {
  return db
    .select(claimColumns)
    .from(providerClaims)
    .leftJoin(providers, eq(providers.id, providerClaims.providerId))
    .where(eq(providerClaims.userId, userId))
    .orderBy(desc(providerClaims.createdAt));
}

export async function getClaimsForReview() {
  return db
    .select({ ...claimColumns, userName: users.name, userEmail: users.email })
    .from(providerClaims)
    .innerJoin(users, eq(users.id, providerClaims.userId))
    .leftJoin(providers, eq(providers.id, providerClaims.providerId))
    .where(eq(providerClaims.status, "pending"))
    .orderBy(providerClaims.createdAt);
}

export async function getRecentProfileEdits(providerId: number, limit = 10) {
  return db
    .select({ id: profileEdits.id, changes: profileEdits.changes, createdAt: profileEdits.createdAt, userName: users.name })
    .from(profileEdits)
    .leftJoin(users, eq(users.id, profileEdits.userId))
    .where(eq(profileEdits.providerId, providerId))
    .orderBy(desc(profileEdits.createdAt))
    .limit(limit);
}

export async function getPendingReviews() {
  return db
    .select({ review: reviews, providerName: providers.name, providerSlug: providers.slug })
    .from(reviews)
    .innerJoin(providers, eq(providers.id, reviews.providerId))
    .where(eq(reviews.status, "pending"))
    .orderBy(reviews.createdAt);
}

/** Public fields only: reviewer identity stays private (double-blind). */
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

export async function isProviderSaved(userId: number, providerId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: savedProviders.providerId })
    .from(savedProviders)
    .where(and(eq(savedProviders.userId, userId), eq(savedProviders.providerId, providerId)));
  return !!row;
}

/** The logged-in user's own reviews, any status. */
export async function getUserReviews(userId: number) {
  return db
    .select({ id: reviews.id, title: reviews.title, status: reviews.status, providerName: providers.name, providerSlug: providers.slug })
    .from(reviews)
    .innerJoin(providers, eq(providers.id, reviews.providerId))
    .where(eq(reviews.userId, userId))
    .orderBy(desc(reviews.createdAt));
}
