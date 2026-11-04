"use server";
/**
 * FILE: apps/admin/src/lib/moderation-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The moderation decisions staff make in the Console:
 *   - provider claims (a website user says "I represent this company"): approve, reject, or create a brand-new
 *     listing from a claim for a company not yet in FundHub;
 *   - reviews: send the reviewer a verification email, publish (approve) or reject a review.
 *   Each decision updates the database, writes an audit entry and (usually) emails the person concerned.
 * WHERE IT RUNS: only on the server (Node.js): it writes to the database and sends email.
 * FRAMEWORK NOTES: `"use server"` (must stay the very first line) turns each exported async function into a
 *   Next.js "server action" the Console's buttons can call directly; Next.js sends the call to the server.
 *   Because such a call is just an HTTP request that anyone could forge, every action begins with
 *   `requireStaff(CAN.moderate)`. Functions that are NOT exported (like `claimWithUser`) cannot be called
 *   from the browser at all; they are private helpers. `revalidatePath` refreshes a page's cached data.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases, `async`/`await`, `Promise<T>`, inferred return types.
 *   - optional chaining `row?.claim`, nullish `??`, non-null assertion `!`, ternary `a ? b : c`.
 *   - Zod schemas with `.coerce` (turn text into numbers) and `.refine` (a custom rule).
 *   - spread `{ ...d }`, template strings, `Record<string, unknown>`.
 */

// `import { a } from "b"` brings named exports from another module into this file.
// Drizzle ORM's `eq(column, value)` builds the SQL condition "column = value".
import { eq } from "drizzle-orm";
// Next.js: mark a page's cached copy as stale so it shows fresh data on the next load.
import { revalidatePath } from "next/cache";
// Zod: validates input from the browser.
import { z } from "zod";
// Shared lists and helpers from our core package: allowed provider types, a function that turns a name into
// a URL-friendly "slug" (e.g. "Acme S.A." → "acme-s-a"), and the allowed category slugs.
import { PROVIDER_TYPES } from "@fundhub/core/enums";
import { slugify } from "@fundhub/core/format";
import { CATEGORY_SLUGS } from "@fundhub/core/taxonomy";
// The shared database connection and the tables used here.
import { db } from "@fundhub/db/client";
import { providerClaims, providers, reviews, users } from "@fundhub/db/schema";
// Our email package: renders a React Email template, logs it, and sends it via Resend.
import { sendEmail } from "@fundhub/email/send";
// Audit log writer, permission check + role table, and the public website's address for links in emails.
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";
import { websiteUrl } from "./site";

/**
 * Kind: type alias (exported).
 * The result every action returns: `ok` (success message) or `error` (problem to show). Both optional.
 */
export type ActionResult = { ok?: string; error?: string };

/**
 * Kind: async function (private helper, not exported).
 * Loads one claim together with the user who made it and, if linked, the provider's name and slug.
 * @param claimId  `number` — the claim's id.
 * @returns        `Promise<{ claim, user, providerName, providerSlug } | undefined>` — `undefined` if not found.
 *                 (TypeScript works this type out from the code.)
 */
async function claimWithUser(claimId: number) {
  // `innerJoin(users, …)`: only claims that have a matching user. `leftJoin(providers, …)`: keep the claim even
  // when it has no provider yet (new-listing claims); then providerName/providerSlug are `null`.
  const [row] = await db
    .select({ claim: providerClaims, user: users, providerName: providers.name, providerSlug: providers.slug })
    .from(providerClaims)
    .innerJoin(users, eq(users.id, providerClaims.userId))
    .leftJoin(providers, eq(providers.id, providerClaims.providerId))
    .where(eq(providerClaims.id, claimId));
  return row;
}

// ---------------------------------------------------------------- claims

/**
 * Kind: server action.
 * Approves a claim on an EXISTING provider listing: the user becomes able to edit that profile.
 * @param claimId  `number` — the claim's id.
 * @returns        `Promise<ActionResult>`.
 */
export async function approveClaim(claimId: number): Promise<ActionResult> {
  // Security: only moderators (owner, operations) may continue.
  const staff = await requireStaff(CAN.moderate);
  const row = await claimWithUser(claimId);
  // Guard: the claim must exist, point to a provider, and still be pending (so it is not decided twice).
  // `row?.claim.providerId` is `undefined` when `row` is missing, and `!undefined` is true.
  if (!row?.claim.providerId || row.claim.status !== "pending") return { error: "Claim not found or already reviewed." };

  // Mark the claim approved, with when and by whom.
  await db
    .update(providerClaims)
    .set({ status: "approved", reviewedAt: new Date(), reviewedBy: staff.id })
    .where(eq(providerClaims.id, claimId));
  // An approved claim implies a provider account.
  await db.update(users).set({ accountType: "provider" }).where(eq(users.id, row.user.id));
  await audit(staff, "approve", "provider_claims", claimId, { provider: row.providerName, user: row.user.email });
  // Tell the user, with a link to edit their profile on the website. `row.providerName!`: the `!` asserts it is
  // not null (true here, because we checked the claim has a provider).
  await sendEmail({
    to: row.user.email,
    toName: row.user.name,
    template: "claim-approved",
    props: { name: row.user.name, companyName: row.providerName!, editUrl: `${websiteUrl()}/account/profiles/${row.providerSlug}` },
    // Links the email log entry to this claim, and records which staff member sent it.
    related: { entity: "provider_claims", id: claimId },
    sentBy: staff.id,
  });
  revalidatePath("/claims");
  return { ok: `Approved. ${row.user.name} can now edit ${row.providerName}.` };
}

/**
 * Kind: server action.
 * Rejects a pending claim (existing listing or new-listing) and emails the user.
 * @param claimId  `number` — the claim's id.
 * @returns        `Promise<ActionResult>`.
 */
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
    // Name to show: the provider's name, else the name they proposed, else a generic phrase (`??` chain).
    props: { name: row.user.name, companyName: row.providerName ?? row.claim.proposedName ?? "the company" },
    related: { entity: "provider_claims", id: claimId },
    sentBy: staff.id,
  });
  revalidatePath("/claims");
  return { ok: "Rejected and the user was notified." };
}

/**
 * Kind: constant (Zod schema).
 * The details staff must fill in to create a new listing from a claim.
 * `z.coerce.number()` converts form text like "25" into the number 25 before checking it.
 * `.refine(rule, message)` adds a check across fields: the minimum fee may not exceed the maximum.
 */
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

/**
 * Kind: server action.
 * New-listing claims: FundHub creates the provider (and sets the fee range), then approves.
 * Staff set category, type, headcount and fees themselves so listings stay consistent and comparable.
 * @param input  `Record<string, unknown>` — raw form values, checked by `newListingSchema`.
 * @returns      `Promise<ActionResult>`.
 */
export async function approveNewListing(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.moderate);
  const parsed = newListingSchema.safeParse(input);
  // Show the first validation message if the form is invalid.
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;
  const row = await claimWithUser(d.claimId);
  // Must be a new-listing claim (it has a proposed company name) and still pending.
  if (!row?.claim.proposedName || row.claim.status !== "pending") return { error: "Claim not found or already reviewed." };

  // The URL slug must be unique; if a provider already uses it, this company probably already exists.
  const slug = slugify(row.claim.proposedName);
  const [clash] = await db.select({ id: providers.id }).from(providers).where(eq(providers.slug, slug));
  if (clash) return { error: `A provider with slug "${slug}" already exists. Ask the user to claim that listing.` };

  // Create the provider, immediately published, and get its new id back.
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
  // Approve the claim and link it to the new provider.
  await db
    .update(providerClaims)
    .set({ status: "approved", providerId: created.id, reviewedAt: new Date(), reviewedBy: staff.id })
    .where(eq(providerClaims.id, d.claimId));
  // The user now has a provider account, as in `approveClaim`.
  await db.update(users).set({ accountType: "provider" }).where(eq(users.id, row.user.id));
  // `...d` copies all the form values into the audit details.
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

/**
 * Kind: async function (private helper).
 * Loads one review together with the provider it is about.
 * @param reviewId  `number`.
 * @returns         `Promise<{ review, provider } | undefined>`.
 */
async function reviewWithProvider(reviewId: number) {
  const [row] = await db
    .select({ review: reviews, provider: providers })
    .from(reviews)
    .innerJoin(providers, eq(providers.id, reviews.providerId))
    .where(eq(reviews.id, reviewId));
  return row;
}

/**
 * Kind: server action.
 * Emails the reviewer asking them to confirm they really wrote the review (an anti-fake-review step).
 * @param reviewId  `number`.
 * @returns         `Promise<ActionResult>` — success, or the email provider's error.
 */
export async function sendReviewVerification(reviewId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.moderate);
  const row = await reviewWithProvider(reviewId);
  if (!row) return { error: "Review not found." };
  // `sendEmail` returns `{ ok: true, … }` or `{ ok: false, error }` instead of throwing.
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
  // Ternary: pass on success or the error. TypeScript knows `res.error` exists only when `res.ok` is false.
  return res.ok ? { ok: `Verification email sent to ${row.review.reviewerEmail}.` } : { error: res.error };
}

/**
 * Kind: server action.
 * Publishing a verified review folds its overall score into the Peer Opinion Score.
 * @param reviewId  `number`.
 * @returns         `Promise<ActionResult>` with the provider's new average.
 */
export async function approveReview(reviewId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.moderate);
  const row = await reviewWithProvider(reviewId);
  if (!row || row.review.status !== "pending") return { error: "Review not found or already handled." };
  const p = row.provider;
  // New running average: (old average × old count + this review's score) ÷ new count.
  // `Math.round(x * 100) / 100` rounds to two decimals.
  const count = p.reviewCount + 1;
  const rating = Math.round(((p.rating * p.reviewCount + row.review.overall) / count) * 100) / 100;

  // Save the provider's new rating and count, then mark the review approved.
  await db.update(providers).set({ rating, reviewCount: count }).where(eq(providers.id, p.id));
  await db.update(reviews).set({ status: "approved", reviewedAt: new Date(), reviewedBy: staff.id }).where(eq(reviews.id, reviewId));
  // The audit keeps the before and after rating, so a score change can always be explained.
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
  // `.toFixed(2)` formats the number with exactly two decimals, e.g. 4.5 → "4.50".
  return { ok: `Published. ${p.name}'s score is now ${rating.toFixed(2)} (${count} reviews).` };
}

/**
 * Kind: server action.
 * Rejects a review (it will not be shown on the website). No email is sent to the reviewer.
 * @param reviewId  `number`.
 * @returns         `Promise<ActionResult>`.
 */
export async function rejectReview(reviewId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.moderate);
  await db.update(reviews).set({ status: "rejected", reviewedAt: new Date(), reviewedBy: staff.id }).where(eq(reviews.id, reviewId));
  await audit(staff, "reject", "reviews", reviewId);
  revalidatePath("/reviews");
  return { ok: "Review rejected." };
}
