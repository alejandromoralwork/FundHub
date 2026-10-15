"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/db/index";
import { PROVIDER_TYPES, providerClaims, providers, REPORT_VISIBILITY, reports } from "@/db/schema";
import { requireAdmin } from "./auth/session";
import { slugify } from "./format";
import { CATEGORY_SLUGS } from "./taxonomy";

export type AdminState = { ok?: string; error?: string };

const MAX_PDF_BYTES = 4 * 1024 * 1024;

export async function rejectClaim(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("claimId"));
  await db.update(providerClaims).set({ status: "rejected", reviewedAt: new Date() }).where(eq(providerClaims.id, id));
  revalidatePath("/admin");
}

/** Approving an existing-listing claim grants edit rights. */
export async function approveClaim(formData: FormData) {
  await requireAdmin();
  const id = Number(formData.get("claimId"));
  await db.update(providerClaims).set({ status: "approved", reviewedAt: new Date() }).where(eq(providerClaims.id, id));
  revalidatePath("/admin");
}

const newListingSchema = z
  .object({
    claimId: z.coerce.number().int().positive(),
    category: z.enum(CATEGORY_SLUGS),
    providerType: z.enum(PROVIDER_TYPES),
    headcount: z.coerce.number().int().positive(),
    priceMin: z.coerce.number().int().positive(),
    priceMax: z.coerce.number().int().positive(),
  })
  .refine((d) => d.priceMin <= d.priceMax, "Min fee must be ≤ max fee");

/** Approving a new-listing claim creates the provider (FundHub sets the fee range) and links it. */
export async function approveNewListing(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const parsed = newListingSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const d = parsed.data;

  const [claim] = await db.select().from(providerClaims).where(eq(providerClaims.id, d.claimId));
  if (!claim?.proposedName) return { error: "Claim not found." };

  const slug = slugify(claim.proposedName);
  const [clash] = await db.select({ id: providers.id }).from(providers).where(eq(providers.slug, slug));
  if (clash) return { error: `A provider with slug "${slug}" already exists. Ask the user to claim it instead.` };

  const [created] = await db
    .insert(providers)
    .values({
      slug,
      name: claim.proposedName,
      category: d.category,
      providerType: d.providerType,
      headcount: d.headcount,
      priceMin: d.priceMin,
      priceMax: d.priceMax,
      website: claim.proposedWebsite,
      status: "published",
    })
    .returning({ id: providers.id });

  await db
    .update(providerClaims)
    .set({ status: "approved", providerId: created.id, reviewedAt: new Date() })
    .where(eq(providerClaims.id, d.claimId));
  revalidatePath("/admin");
  return { ok: `Created ${claim.proposedName}. The provider can now complete the profile.` };
}

const reportSchema = z.object({
  title: z.string().trim().min(3).max(160),
  period: z.string().trim().min(2).max(40),
  summary: z.string().trim().max(600).default(""),
  visibility: z.enum(REPORT_VISIBILITY),
});

export async function uploadReport(_prev: AdminState, formData: FormData): Promise<AdminState> {
  await requireAdmin();
  const parsed = reportSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF file." };
  if (file.size > MAX_PDF_BYTES) return { error: "PDF must be 4 MB or smaller." };

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") return { error: "That file isn't a PDF." };

  const base = slugify(`${parsed.data.title} ${parsed.data.period}`);
  const slug = `${base}-${Date.now().toString(36)}`;
  await db.insert(reports).values({ ...parsed.data, slug, pdf: buf, fileSize: buf.length });
  revalidatePath("/admin");
  revalidatePath("/data-intelligence");
  return { ok: `Uploaded "${parsed.data.title}".` };
}

export async function updateReportVisibility(formData: FormData) {
  await requireAdmin();
  const visibility = z.enum(REPORT_VISIBILITY).parse(formData.get("visibility"));
  await db.update(reports).set({ visibility }).where(eq(reports.id, Number(formData.get("reportId"))));
  revalidatePath("/admin");
  revalidatePath("/data-intelligence");
}

export async function deleteReport(formData: FormData) {
  await requireAdmin();
  await db.delete(reports).where(eq(reports.id, Number(formData.get("reportId"))));
  revalidatePath("/admin");
  revalidatePath("/data-intelligence");
}
