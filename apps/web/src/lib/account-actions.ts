"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@fundhub/db/client";
import {
  ASSET_CLASSES,
  CERTIFICATIONS,
  LICENCES,
  PROVIDER_TYPES,
  profileEdits,
  providerClaims,
  providers,
  REGULATORY_SCOPES,
  TECH_STACKS,
  type Provider,
} from "@fundhub/db/schema";
import { canManageProvider, requireUser } from "./auth/session";
import { ALL_SERVICES, CATEGORY_SLUGS } from "@fundhub/core/taxonomy";

export type ActionState = { ok?: string; error?: string; fieldErrors?: Record<string, string> };

function fieldErrors(issues: z.core.$ZodIssue[]) {
  const out: Record<string, string> = {};
  for (const i of issues) out[String(i.path[0])] ??= i.message;
  return out;
}

// ---------------------------------------------------------------- claims

const claimSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("existing"),
    providerId: z.coerce.number().int().positive({ message: "Choose your company" }),
    jobTitle: z.string().trim().min(2, "Enter your job title").max(120),
    message: z.string().trim().max(2000).default(""),
  }),
  z.object({
    mode: z.literal("new"),
    proposedName: z.string().trim().min(2, "Enter the company name").max(160),
    proposedCategory: z.enum(CATEGORY_SLUGS, { message: "Choose the main service category" }),
    proposedWebsite: z.string().trim().url("Enter a full URL, e.g. https://example.lu").max(300),
    jobTitle: z.string().trim().min(2, "Enter your job title").max(120),
    message: z.string().trim().max(2000).default(""),
  }),
]);

export async function submitClaim(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const parsed = claimSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { fieldErrors: fieldErrors(parsed.error.issues) };
  const d = parsed.data;

  if (d.mode === "existing") {
    const [existing] = await db
      .select({ id: providerClaims.id })
      .from(providerClaims)
      .where(and(eq(providerClaims.userId, user.id), eq(providerClaims.providerId, d.providerId)));
    if (existing) return { error: "You already have a claim for this company." };
    await db.insert(providerClaims).values({
      userId: user.id,
      providerId: d.providerId,
      jobTitle: d.jobTitle,
      message: d.message,
    });
  } else {
    await db.insert(providerClaims).values({
      userId: user.id,
      proposedName: d.proposedName,
      proposedCategory: d.proposedCategory,
      proposedWebsite: d.proposedWebsite,
      jobTitle: d.jobTitle,
      message: d.message,
    });
  }
  revalidatePath("/account");
  return { ok: "Claim submitted. FundHub will confirm it, usually within two business days." };
}

// ---------------------------------------------------------------- profile edits

/** Textarea lists: one item per line (commas also accepted). */
const lines = z
  .string()
  .default("")
  .transform((v) =>
    v
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 30),
  );

const pick = <T extends string>(allowed: readonly T[]) => z.array(z.enum(allowed as [T, ...T[]])).default([]);

/** Only factual fields. Fees, scores, reviews, Verified and the primary category stay FundHub-controlled. */
const profileSchema = z.object({
  description: z.string().trim().max(1200).default(""),
  website: z.union([z.literal(""), z.string().trim().url("Enter a full URL, e.g. https://example.lu").max(300)]),
  headquarters: z.string().trim().min(2, "Enter your Luxembourg address/area").max(160),
  providerType: z.enum(PROVIDER_TYPES),
  headcount: z.coerce.number().int().positive("Enter your local headcount").max(100_000),
  mandates: z.coerce.number().int().min(0).max(100_000),
  foundedYear: z.union([z.literal(""), z.coerce.number().int().min(1800).max(new Date().getFullYear())]),
  services: z
    .array(z.string())
    .default([])
    .refine((l) => l.every((s) => ALL_SERVICES.includes(s)), "Unknown service")
    .refine((l) => l.length > 0, "Select at least one service"),
  secondaryCategories: pick(CATEGORY_SLUGS),
  techStack: pick(TECH_STACKS),
  otherTech: lines,
  regulatoryScope: pick(REGULATORY_SCOPES),
  assetClasses: pick(ASSET_CLASSES),
  licences: pick(LICENCES),
  certifications: pick(CERTIFICATIONS),
  topClients: lines,
  footprint: lines,
  tags: lines,
});

const LIST_FIELDS = [
  "services",
  "secondaryCategories",
  "techStack",
  "regulatoryScope",
  "assetClasses",
  "licences",
  "certifications",
] as const;

export async function updateProviderProfile(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await requireUser();
  const providerId = Number(formData.get("providerId"));
  if (!providerId || !(await canManageProvider(user, providerId))) return { error: "You can't edit this profile." };

  const raw: Record<string, unknown> = Object.fromEntries(formData);
  for (const f of LIST_FIELDS) raw[f] = formData.getAll(f);
  const parsed = profileSchema.safeParse(raw);
  if (!parsed.success) return { error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error.issues) };

  const [current] = await db.select().from(providers).where(eq(providers.id, providerId));
  if (!current) return { error: "Profile not found." };

  const { otherTech, website, foundedYear, ...d } = parsed.data;
  const next: Partial<Provider> = {
    ...d,
    // The primary category is implied, so it isn't stored as secondary too.
    secondaryCategories: d.secondaryCategories.filter((c) => c !== current.category),
    techStack: [...new Set([...d.techStack, ...otherTech])],
    website: website || null,
    foundedYear: foundedYear === "" ? null : foundedYear,
  };

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(next)) {
    const before = current[k as keyof Provider];
    if (JSON.stringify(before) !== JSON.stringify(v)) changes[k] = { from: before, to: v };
  }
  if (!Object.keys(changes).length) return { ok: "No changes to save." };

  await db
    .update(providers)
    .set({ ...next, providerUpdatedAt: new Date() })
    .where(eq(providers.id, providerId));
  await db.insert(profileEdits).values({ providerId, userId: user.id, changes });

  revalidatePath(`/providers/${current.slug}`);
  return { ok: `Saved ${Object.keys(changes).length} change(s). Your public profile is updated.` };
}
