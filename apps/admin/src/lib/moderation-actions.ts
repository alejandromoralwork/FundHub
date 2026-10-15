"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PROVIDER_TYPES } from "@fundhub/core/enums";
import { slugify } from "@fundhub/core/format";
import { CATEGORY_SLUGS } from "@fundhub/core/taxonomy";
import { db } from "@fundhub/db/client";
import { providerClaims, providers, reviews, users } from "@fundhub/db/schema";
import { sendEmail } from "@fundhub/email/send";
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";
import { websiteUrl } from "./site";

export type ActionResult = { ok?: string; error?: string };

async function claimWithUser(claimId: number) {
  const [row] = await db
    .select({ claim: providerClaims, user: users, providerName: providers.name, providerSlug: providers.slug })
    .from(providerClaims)
    .innerJoin(users, eq(users.id, providerClaims.userId))
    .leftJoin(providers, eq(providers.id, providerClaims.providerId))
    .where(eq(providerClaims.id, claimId));
  return row;
}

// ---------------------------------------------------------------- claims

export async function approveClaim(claimId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.moderate);
  const row = await claimWithUser(claimId);
  if (!row?.claim.providerId || row.claim.status !== "pending") return { error: "Claim not found or already reviewed." };

  await db
    .update(providerClaims)
    .set({ status: "approved", reviewedAt: new Date(), reviewedBy: staff.id })
    .where(eq(providerClaims.id, claimId));
  // An approved claim implies a provider account.
  await db.update(users).set({ accountType: "provider" }).where(eq(users.id, row.user.id));
  await audit(staff, "approve", "provider_claims", claimId, { provider: row.providerName, user: row.user.email });
  await sendEmail({
    to: row.user.email,
    toName: row.user.name,
    template: "claim-approved",
    props: { name: row.user.name, companyName: row.providerName!, editUrl: `${websiteUrl()}/account/profiles/${row.providerSlug}` },
    related: { entity: "provider_claims", id: claimId },
    sentBy: staff.id,
  });
  revalidatePath("/claims");
  return { ok: `Approved. ${row.user.name} can now edit ${row.providerName}.` };
}

export async function rejectClaim(claimId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.moderate);
  const row = await claimWithUser(claimId);
  if (!row || row.claim.status !== "pending") return { error: "Claim not found or already reviewed." };
  await db
    .update(providerClaims)
    .set({ status: "rejected", reviewedAt: new Date(), reviewedBy: staff.id })
    .where(eq(providerClaims.id, claimId));
  await audit(staff, "reject", "provider_claims", claimId);
  await sendEmail({
    to: row.user.email,
    toName: row.user.name,
    template: "claim-rejected",
    props: { name: row.user.name, companyName: row.providerName ?? row.claim.proposedName ?? "the company" },
    related: { entity: "provider_claims", id: claimId },
    sentBy: staff.id,
  });
  revalidatePath("/claims");
  return { ok: "Rejected and the user was notified." };
}

const newListingSchema = z
  .object({
    claimId: z.coerce.number().int().positive(),
    category: z.enum(CATEGORY_SLUGS),
    providerType: z.enum(PROVIDER_TYPES),
    headcount: z.coerce.number().int().positive("Headcount is required"),
    priceMin: z.coerce.number().int().positive("Minimum fee is required"),
    priceMax: z.coerce.number().int().positive("Maximum fee is required"),
  })
  .refine((d) => d.priceMin <= d.priceMax, "Min fee must be ≤ max fee");

/** New-listing claims: FundHub creates the provider (and sets the fee range), then approves. */
export async function approveNewListing(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.moderate);
  const parsed = newListingSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  const row = await claimWithUser(d.claimId);
  if (!row?.claim.proposedName || row.claim.status !== "pending") return { error: "Claim not found or already reviewed." };

  const slug = slugify(row.claim.proposedName);
  const [clash] = await db.select({ id: providers.id }).from(providers).where(eq(providers.slug, slug));
  if (clash) return { error: `A provider with slug "${slug}" already exists. Ask the user to claim that listing.` };

  const [created] = await db
    .insert(providers)
    .values({
      slug,
      name: row.claim.proposedName,
      category: d.category,
      providerType: d.providerType,
      headcount: d.headcount,
      priceMin: d.priceMin,
      priceMax: d.priceMax,
      website: row.claim.proposedWebsite,
      status: "published",
    })
    .returning({ id: providers.id });
  await db
    .update(providerClaims)
    .set({ status: "approved", providerId: created.id, reviewedAt: new Date(), reviewedBy: staff.id })
    .where(eq(providerClaims.id, d.claimId));
  await db.update(users).set({ accountType: "provider" }).where(eq(users.id, row.user.id));
  await audit(staff, "create-listing", "providers", created.id, { fromClaim: d.claimId, ...d });
  await sendEmail({
    to: row.user.email,
    toName: row.user.name,
    template: "claim-approved",
    props: { name: row.user.name, companyName: row.claim.proposedName, editUrl: `${websiteUrl()}/account/profiles/${slug}` },
    related: { entity: "provider_claims", id: d.claimId },
    sentBy: staff.id,
  });
  revalidatePath("/claims");
  return { ok: `Created ${row.claim.proposedName} and approved the claim.` };
}

// ---------------------------------------------------------------- reviews

async function reviewWithProvider(reviewId: number) {
  const [row] = await db
    .select({ review: reviews, provider: providers })
    .from(reviews)
    .innerJoin(providers, eq(providers.id, reviews.providerId))
    .where(eq(reviews.id, reviewId));
  return row;
}

export async function sendReviewVerification(reviewId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.moderate);
  const row = await reviewWithProvider(reviewId);
  if (!row) return { error: "Review not found." };
  const res = await sendEmail({
    to: row.review.reviewerEmail,
    toName: row.review.reviewerName,
    template: "review-verification",
    props: { name: row.review.reviewerName, providerName: row.provider.name },
    related: { entity: "reviews", id: reviewId },
    sentBy: staff.id,
  });
  await audit(staff, "verification-email", "reviews", reviewId);
  revalidatePath("/reviews");
  return res.ok ? { ok: `Verification email sent to ${row.review.reviewerEmail}.` } : { error: res.error };
}

/** Publishing a verified review folds its overall score into the Peer Opinion Score. */
export async function approveReview(reviewId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.moderate);
  const row = await reviewWithProvider(reviewId);
  if (!row || row.review.status !== "pending") return { error: "Review not found or already handled." };
  const p = row.provider;
  const count = p.reviewCount + 1;
  const rating = Math.round(((p.rating * p.reviewCount + row.review.overall) / count) * 100) / 100;

  await db.update(providers).set({ rating, reviewCount: count }).where(eq(providers.id, p.id));
  await db.update(reviews).set({ status: "approved", reviewedAt: new Date(), reviewedBy: staff.id }).where(eq(reviews.id, reviewId));
  await audit(staff, "publish", "reviews", reviewId, { provider: p.name, ratingFrom: p.rating, ratingTo: rating });
  await sendEmail({
    to: row.review.reviewerEmail,
    toName: row.review.reviewerName,
    template: "review-published",
    props: { name: row.review.reviewerName, providerName: p.name, profileUrl: `${websiteUrl()}/providers/${p.slug}` },
    related: { entity: "reviews", id: reviewId },
    sentBy: staff.id,
  });
  revalidatePath("/reviews");
  return { ok: `Published. ${p.name}'s score is now ${rating.toFixed(2)} (${count} reviews).` };
}

export async function rejectReview(reviewId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.moderate);
  await db.update(reviews).set({ status: "rejected", reviewedAt: new Date(), reviewedBy: staff.id }).where(eq(reviews.id, reviewId));
  await audit(staff, "reject", "reviews", reviewId);
  revalidatePath("/reviews");
  return { ok: "Review rejected." };
}
