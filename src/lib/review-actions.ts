"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/index";
import { CLIENT_RELATIONSHIPS, providers, reviews, users, providerClaims } from "@/db/schema";
import { requireAdmin } from "./auth/session";

export type ReviewFormState =
  | { status: "idle" }
  | { status: "error"; message: string; fieldErrors: Record<string, string>; values: Record<string, unknown> }
  | { status: "success" };

const FREE_MAIL = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "icloud.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "gmx.de",
  "web.de",
  "pt.lu",
]);

const score = z.coerce.number().int().min(1, "Rate 1–5").max(5);

const reviewSchema = z.object({
  providerId: z.coerce.number().int().positive(),
  reviewerName: z.string().trim().min(2, "Enter your name").max(120),
  reviewerEmail: z.string().trim().toLowerCase().email("Enter your work email").max(200),
  reviewerCompany: z.string().trim().min(2, "Enter your company").max(160),
  reviewerRole: z.string().trim().min(2, "Enter your role").max(120),
  relationship: z.enum(CLIENT_RELATIONSHIPS, { message: "Choose your relationship" }),
  clientSince: z.union([z.literal(""), z.coerce.number().int().min(1950).max(new Date().getFullYear())]).optional(),
  fundStructure: z.string().trim().max(60).default(""),
  overall: score,
  serviceQuality: score,
  responsiveness: score,
  pricingTransparency: score,
  technology: score,
  title: z.string().trim().min(5, "Add a short title").max(120),
  body: z.string().trim().min(80, "Please write at least 80 characters").max(4000),
  evidence: z.string().trim().min(5, "Tell us how we can verify you're a client").max(1000),
  attest: z.literal("on", { message: "Please confirm the declaration" }),
});

const domainOf = (emailOrUrl: string) => {
  try {
    const host = emailOrUrl.includes("@") ? emailOrUrl.split("@")[1]! : new URL(emailOrUrl).hostname;
    return host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

export async function submitReview(_prev: ReviewFormState, formData: FormData): Promise<ReviewFormState> {
  if (formData.get("website")) return { status: "success" }; // honeypot
  const raw = Object.fromEntries(formData);
  const parsed = reviewSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { status: "error", message: "Please fix the highlighted fields.", fieldErrors, values: raw };
  }
  const d = parsed.data;

  const [provider] = await db
    .select({ id: providers.id, website: providers.website, slug: providers.slug })
    .from(providers)
    .where(eq(providers.id, d.providerId));
  if (!provider) return { status: "error", message: "Provider not found.", fieldErrors: {}, values: raw };

  const emailDomain = domainOf(d.reviewerEmail);
  // Hard block: nobody may review their own employer.
  if (provider.website && domainOf(provider.website) === emailDomain) {
    return {
      status: "error",
      message: "Reviews from the provider's own staff aren't accepted.",
      fieldErrors: { reviewerEmail: "This email belongs to the provider itself" },
      values: raw,
    };
  }
  const [managed] = await db
    .select({ id: providerClaims.id })
    .from(providerClaims)
    .innerJoin(users, eq(users.id, providerClaims.userId))
    .where(and(eq(providerClaims.providerId, provider.id), eq(users.email, d.reviewerEmail)));
  if (managed) {
    return { status: "error", message: "Provider account holders can't review their own company.", fieldErrors: {}, values: raw };
  }

  const flags: string[] = [];
  if (FREE_MAIL.has(emailDomain)) flags.push("Personal email domain: ask for a work email or other proof");
  if (!d.reviewerCompany.toLowerCase().includes(emailDomain.split(".")[0] ?? "")) {
    flags.push(`Company "${d.reviewerCompany}" doesn't obviously match email domain ${emailDomain}`);
  }

  const { attest: _attest, clientSince, ...values } = d;
  try {
    await db.insert(reviews).values({ ...values, clientSince: clientSince === "" ? null : clientSince ?? null, flags });
  } catch {
    return {
      status: "error",
      message: "You've already submitted a review for this provider.",
      fieldErrors: {},
      values: raw,
    };
  }
  return { status: "success" };
}

/** Publishing a verified review folds its overall score into the Peer Opinion Score. */
export async function approveReview(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("reviewId"));
  const [r] = await db.select().from(reviews).where(eq(reviews.id, id));
  if (!r || r.status !== "pending") return;
  const [p] = await db.select().from(providers).where(eq(providers.id, r.providerId));
  if (!p) return;

  const count = p.reviewCount + 1;
  const rating = Math.round(((p.rating * p.reviewCount + r.overall) / count) * 100) / 100;
  await db.update(providers).set({ rating, reviewCount: count }).where(eq(providers.id, p.id));
  await db.update(reviews).set({ status: "approved", reviewedAt: new Date() }).where(eq(reviews.id, id));
  revalidatePath("/admin");
  revalidatePath(`/providers/${p.slug}`);
}

export async function rejectReview(formData: FormData) {
  await requireAdmin();
  await db
    .update(reviews)
    .set({ status: "rejected", reviewedAt: new Date() })
    .where(eq(reviews.id, Number(formData.get("reviewId"))));
  revalidatePath("/admin");
}
