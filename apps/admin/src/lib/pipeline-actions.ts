"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ASSET_CLASSES, CERTIFICATIONS, INGEST_SOURCES, LICENCES, REGULATORY_SCOPES } from "@fundhub/core/enums";
import { ALL_SERVICES } from "@fundhub/core/taxonomy";
import { db } from "@fundhub/db/client";
import { ingestJobs, ingestRecords, providers } from "@fundhub/db/schema";
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";
import { dispatchScrapeWorkflow } from "./github";

export type ActionResult = { ok?: string; error?: string };

const strList = z.array(z.string().trim().min(1)).max(50);
const enumList = (allowed: readonly string[]) => z.array(z.string()).refine((l) => l.every((s) => allowed.includes(s)), "Unknown value");

/** Scraped keys that may be written to a provider profile, with their validation. */
const ACCEPTABLE: Record<string, z.ZodType> = {
  description: z.string().trim().min(10).max(1200),
  headquarters: z.string().trim().min(2).max(160),
  rcsNumber: z.string().trim().min(2).max(40),
  headcount: z.number().int().positive().max(200_000),
  foundedYear: z.number().int().min(1800).max(new Date().getFullYear()),
  services: enumList(ALL_SERVICES),
  licences: enumList(LICENCES),
  assetClasses: enumList(ASSET_CLASSES),
  certifications: enumList(CERTIFICATIONS),
  regulatoryScope: enumList(REGULATORY_SCOPES),
  techStack: strList,
  footprint: strList,
};

export async function queueScrape(source: string, providerId: number | null): Promise<ActionResult> {
  const staff = await requireStaff(CAN.pipeline);
  const s = z.enum(INGEST_SOURCES).parse(source);
  const [job] = await db.insert(ingestJobs).values({ source: s, providerId, requestedBy: staff.id }).returning({ id: ingestJobs.id });
  await audit(staff, "queue", "ingest_jobs", job.id, { source: s, providerId });
  const started = await dispatchScrapeWorkflow();
  revalidatePath("/pipeline");
  return {
    ok: started
      ? "Queued and the data module was started. Results appear in the review queue in a few minutes."
      : "Queued. It runs in the daily sweep (set GITHUB_DISPATCH_TOKEN to start runs immediately).",
  };
}

/** Writes the selected fields into the live profile; the rest of the record stays unapplied. */
export async function acceptFields(recordId: number, fields: string[]): Promise<ActionResult> {
  const staff = await requireStaff(CAN.editData);
  const [rec] = await db.select().from(ingestRecords).where(eq(ingestRecords.id, recordId));
  if (!rec || rec.status !== "pending" || !rec.providerId) return { error: "Record not found or already reviewed." };
  if (!fields.length) return { error: "Select at least one field." };

  const set: Record<string, unknown> = {};
  for (const key of fields) {
    const schema = ACCEPTABLE[key];
    const extracted = rec.extracted[key];
    if (!schema || !extracted) return { error: `"${key}" can't be applied to a profile.` };
    const parsed = schema.safeParse(extracted.value);
    if (!parsed.success) return { error: `Invalid value for ${key}: ${parsed.error.issues[0]?.message}` };
    set[key] = parsed.data;
  }

  const [before] = await db.select().from(providers).where(eq(providers.id, rec.providerId));
  if (!before) return { error: "Provider no longer exists." };
  await db.update(providers).set(set).where(eq(providers.id, rec.providerId));
  const allKeys = Object.keys(rec.extracted).filter((k) => k in ACCEPTABLE);
  await db
    .update(ingestRecords)
    .set({
      status: fields.length >= allKeys.length ? "accepted" : "partial",
      acceptedFields: fields,
      reviewedBy: staff.id,
      reviewedAt: new Date(),
    })
    .where(eq(ingestRecords.id, recordId));
  await audit(staff, "accept-ingest", "providers", rec.providerId, {
    record: recordId,
    source: rec.source,
    changes: Object.fromEntries(fields.map((k) => [k, { from: before[k as keyof typeof before], to: set[k] }])),
  });
  revalidatePath("/pipeline");
  return { ok: `Applied ${fields.length} field(s) to ${before.name}.` };
}

export async function rejectRecord(recordId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.editData);
  await db.update(ingestRecords).set({ status: "rejected", reviewedBy: staff.id, reviewedAt: new Date() }).where(eq(ingestRecords.id, recordId));
  await audit(staff, "reject-ingest", "ingest_records", recordId);
  revalidatePath("/pipeline");
  return { ok: "Record dismissed." };
}
